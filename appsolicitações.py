import json
import logging
import re
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
STATE_FILE = DATA_DIR / "solicitacoes_state.json"
DATABASE_FILE = BASE_DIR / "solicitacoes.db"
LOGGER = logging.getLogger(__name__)
STORAGE_LOCK = threading.RLock()

DEFAULT_STATE = {
    "users": [],
    "demands": [],
    "departments": [],
    "forms": [],
    "requests": [],
    "updatedAt": 0,
}

app = FastAPI(title="Gestão de Solicitações")
app.mount("/solicitacoes-static", StaticFiles(directory=STATIC_DIR), name="solicitacoes_static")


class StateConflictError(RuntimeError):
    pass


@app.middleware("http")
async def no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    response.headers["Vary"] = "*"
    return response


def _normalize_state(data: object) -> dict:
    if not isinstance(data, dict):
        raise ValueError("O estado persistido não é um objeto JSON.")

    normalized = DEFAULT_STATE.copy()
    for key in ("users", "demands", "departments", "forms", "requests"):
        value = data.get(key, [])
        if not isinstance(value, list):
            raise ValueError(f"O campo persistido '{key}' não é uma lista.")
        normalized[key] = value

    updated_at = data.get("updatedAt", 0)
    normalized["updatedAt"] = int(updated_at) if isinstance(updated_at, (int, float)) else 0
    return normalized


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_FILE, timeout=30)
    connection.execute("PRAGMA busy_timeout = 30000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS solicitacoes_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    return connection


@contextmanager
def _database():
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _initial_state() -> dict:
    if not STATE_FILE.exists():
        return DEFAULT_STATE.copy()
    try:
        return _normalize_state(json.loads(STATE_FILE.read_text(encoding="utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError(
            f"Não foi possível migrar o estado de {STATE_FILE.name}; o arquivo foi preservado."
        ) from exc


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with STORAGE_LOCK, _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT updated_at FROM solicitacoes_state WHERE id = 1"
        ).fetchone()
        if row:
            if STATE_FILE.exists():
                legacy_state = _initial_state()
                if legacy_state["updatedAt"] > int(row[0]):
                    connection.execute(
                        "UPDATE solicitacoes_state SET payload = ?, updated_at = ? WHERE id = 1",
                        (
                            json.dumps(legacy_state, ensure_ascii=False),
                            legacy_state["updatedAt"],
                        ),
                    )
            return

        initial = _initial_state()
        connection.execute(
            "INSERT INTO solicitacoes_state (id, payload, updated_at) VALUES (1, ?, ?)",
            (
                json.dumps(initial, ensure_ascii=False),
                initial["updatedAt"],
            ),
        )


def _read_state(connection: sqlite3.Connection) -> dict:
    row = connection.execute(
        "SELECT payload, updated_at FROM solicitacoes_state WHERE id = 1"
    ).fetchone()
    if row is None:
        raise RuntimeError("O registro principal do estado não existe.")
    try:
        state = _normalize_state(json.loads(row[0]))
    except (json.JSONDecodeError, ValueError) as exc:
        raise RuntimeError("O estado salvo no banco está inválido e foi preservado.") from exc
    state["updatedAt"] = int(row[1])
    return state


def _auto_fix_state(state: dict) -> bool:
    """Auto-corrige requests antigas e reidrata materiais/RC quando possível."""
    fixed = False
    demands_map = {d.get("id"): d for d in state.get("demands", [])}
    def clean_material_name(value: object) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        lowered = text.casefold()
        forbidden = {
            "material",
            "material 1",
            "teste",
            "testes",
            "compra",
            "descreva a tarefa",
            "descreva a",
            "codigo sap",
            "código sap",
            "cod sap",
        }
        if lowered in forbidden or lowered.startswith("descreva a"):
            return ""
        return text

    def normalize_rc_materials(items: object) -> list[dict[str, str]]:
        normalized: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            material = clean_material_name(
                item.get("material") or item.get("nome") or item.get("materialNome")
            )
            cod_sap = str(item.get("codSap") or item.get("sap") or item.get("codigoSap") or "").strip()
            if not material:
                continue
            key = (material.casefold(), cod_sap)
            if key in seen:
                continue
            seen.add(key)
            normalized.append({"material": material, "codSap": cod_sap})
        return normalized

    def upsert_material_catalog(material_name: str, cod_sap: str) -> bool:
        existing_material = next(
            (
                material
                for material in state.get("materials", [])
                if str(material.get("nome") or "").strip().casefold() == material_name.casefold()
            ),
            None,
        )
        if existing_material:
            if cod_sap and str(existing_material.get("codSap") or "").strip() != cod_sap:
                existing_material["codSap"] = cod_sap
                return True
            return False
        state.setdefault("materials", []).append(
            {"id": str(uuid4()), "nome": material_name, "codSap": cod_sap}
        )
        return True

    for form in state.get("forms", []):
        if not isinstance(form, dict):
            continue
        rc_materiais = normalize_rc_materials(form.get("rcMateriais"))
        if rc_materiais and form.get("rcMateriais") != rc_materiais:
            form["rcMateriais"] = rc_materiais
            fixed = True
        if rc_materiais:
            primary_rc_material = next((item for item in rc_materiais if item.get("material")), None)
            if primary_rc_material:
                if form.get("material") != primary_rc_material["material"]:
                    form["material"] = primary_rc_material["material"]
                    fixed = True
                if form.get("codSap") != primary_rc_material["codSap"]:
                    form["codSap"] = primary_rc_material["codSap"]
                    fixed = True
            for item in rc_materiais:
                if upsert_material_catalog(item["material"], item["codSap"]):
                    fixed = True

    forms_by_id = {
        str(form.get("id")): form
        for form in state.get("forms", [])
        if isinstance(form, dict) and form.get("id")
    }

    for request in state.get("requests", []):
        if not request.get("requestId"):
            request["requestId"] = _next_request_id(state.get("requests", []))
            fixed = True
        if not request.get("slaDias"):
            demand = demands_map.get(request.get("demandaId"))
            request["slaDias"] = (demand.get("sla") if demand else None) or 1
            fixed = True
        form = forms_by_id.get(str(request.get("formId") or ""))
        rc_materiais = normalize_rc_materials(request.get("rcMateriais"))
        if not rc_materiais and form:
            rc_materiais = normalize_rc_materials(form.get("rcMateriais"))
        if rc_materiais and request.get("rcMateriais") != rc_materiais:
            request["rcMateriais"] = rc_materiais
            fixed = True
        if rc_materiais:
            primary_rc_material = next((item for item in rc_materiais if item.get("material")), None)
            if primary_rc_material:
                if request.get("material") != primary_rc_material["material"]:
                    request["material"] = primary_rc_material["material"]
                    fixed = True
                if request.get("codSap") != (primary_rc_material["codSap"] or "—"):
                    request["codSap"] = primary_rc_material["codSap"] or "—"
                    fixed = True
            for item in rc_materiais:
                if upsert_material_catalog(item["material"], item["codSap"]):
                    fixed = True
    return fixed


def load_state() -> dict:
    ensure_storage()
    with STORAGE_LOCK, _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            state = _read_state(connection)
            if _auto_fix_state(state):
                result = _write_state(connection, state)
                connection.commit()
                return result
            connection.commit()
            return state
        except Exception:
            connection.rollback()
            raise


def _next_updated_at(current: dict) -> int:
    return max(int(time.time() * 1000), int(current.get("updatedAt", 0)) + 1)


def _write_state(connection: sqlite3.Connection, state: dict) -> dict:
    state["updatedAt"] = _next_updated_at(state)
    connection.execute(
        "UPDATE solicitacoes_state SET payload = ?, updated_at = ? WHERE id = 1",
        (json.dumps(state, ensure_ascii=False), state["updatedAt"]),
    )
    return state


def save_state(payload: dict) -> dict:
    ensure_storage()
    with STORAGE_LOCK, _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            current = _read_state(connection)
            expected_updated_at = payload.get("updatedAt")
            if expected_updated_at != current["updatedAt"]:
                raise StateConflictError(
                    "Os dados foram alterados por outro usuário. Recarregue a página e tente novamente."
                )

            cleaned = DEFAULT_STATE.copy()
            for key in ("users", "demands", "departments", "materials", "forms", "requests"):
                value = payload.get(key)
                if not isinstance(value, list):
                    raise ValueError(f"O campo '{key}' deve ser uma lista.")
                cleaned[key] = value
            cleaned["updatedAt"] = current["updatedAt"]
            result = _write_state(connection, cleaned)
            connection.commit()
            return result
        except Exception:
            connection.rollback()
            raise


def _required_text(payload: dict, key: str, label: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Informe {label}.")
    return value.strip()


def _safe_uuid(value: object) -> str:
    if isinstance(value, str):
        try:
            return str(UUID(value))
        except ValueError:
            pass
    return str(uuid4())


def _next_request_id(requests: list[dict]) -> str:
    numbers = []
    for request in requests:
        match = re.fullmatch(r"SOL-(\d+)", str(request.get("requestId", "")))
        if match:
            numbers.append(int(match.group(1)))
    return f"SOL-{max(numbers, default=0) + 1:04d}"


def create_form(payload: dict) -> dict:
    ensure_storage()
    with STORAGE_LOCK, _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            state = _read_state(connection)
            form_id = _safe_uuid(payload.get("clientId"))
            if any(item.get("id") == form_id for item in state["forms"]):
                connection.commit()
                return state

            def clean_material_name(value: object) -> str:
                text = str(value or "").strip()
                if not text:
                    return ""
                lowered = text.casefold()
                forbidden = {
                    "material",
                    "material 1",
                    "teste",
                    "testes",
                    "compra",
                    "descreva a tarefa",
                    "descreva a",
                    "codigo sap",
                    "código sap",
                    "cod sap",
                }
                if lowered in forbidden or lowered.startswith("descreva a"):
                    return ""
                return text

            def normalize_rc_materials(items: object) -> list[dict[str, str]]:
                normalized: list[dict[str, str]] = []
                seen: set[tuple[str, str]] = set()
                for item in items if isinstance(items, list) else []:
                    if not isinstance(item, dict):
                        continue
                    material = clean_material_name(
                        item.get("material") or item.get("nome") or item.get("materialNome")
                    )
                    cod_sap = str(
                        item.get("codSap") or item.get("sap") or item.get("codigoSap") or ""
                    ).strip()
                    if not material:
                        continue
                    key = (material.casefold(), cod_sap)
                    if key in seen:
                        continue
                    seen.add(key)
                    normalized.append({"material": material, "codSap": cod_sap})
                return normalized

            rc_materiais = normalize_rc_materials(payload.get("rcMateriais"))
            incoming_materials = [
                *(payload.get("materials") or []),
                *rc_materiais,
                *(payload.get("materiais") or []),
            ]
            for item in incoming_materials:
                if not isinstance(item, dict):
                    continue
                material_name = clean_material_name(
                    item.get("nome")
                    or item.get("material")
                    or item.get("materialNome")
                    or item.get("descricao")
                )
                cod_sap = str(
                    item.get("codSap") or item.get("sap") or item.get("codigoSap") or ""
                ).strip()
                if not material_name:
                    continue
                existing_material = next(
                    (
                        material
                        for material in state["materials"]
                        if str(material.get("nome") or "").strip().casefold() == material_name.casefold()
                    ),
                    None,
                )
                if existing_material:
                    if cod_sap and str(existing_material.get("codSap") or "").strip() != cod_sap:
                        existing_material["codSap"] = cod_sap
                    continue
                state["materials"].append(
                    {
                        "id": str(uuid4()),
                        "nome": material_name,
                        "codSap": cod_sap,
                    }
                )

            department_id = _required_text(payload, "departamentoId", "o departamento")
            demand_id = _required_text(payload, "demandaId", "o tipo de demanda")
            department = next(
                (item for item in state["departments"] if item.get("id") == department_id),
                None,
            )
            # Se não encontrar como department ID, cria um department virtual com o nome
            if department is None:
                department = {"id": department_id, "nome": department_id}
            
            demand = next(
                (item for item in state["demands"] if item.get("id") == demand_id),
                None,
            )
            if demand is None:
                # Compatibilidade com clientes antigos que podem enviar o nome da demanda
                # em vez do ID (ex.: "FS", "Pagamento de boletos").
                demand_name = str(demand_id).strip().casefold()
                demand = next(
                    (
                        item
                        for item in state["demands"]
                        if str(item.get("nome") or "").strip().casefold() == demand_name
                    ),
                    None,
                )
            if demand is None:
                raise ValueError("O tipo de demanda selecionado não existe mais.")

            responsavel = _required_text(payload, "responsavel", "o nome do responsável")
            primary_rc_material = next(
                (item for item in rc_materiais if item.get("material")),
                None,
            )
            form = {
                "id": form_id,
                "nome": responsavel,
                "responsavel": responsavel,
                "departamentoId": department_id,
                "demandaId": demand_id,
                "centroCusto": str(payload.get("centroCusto", "")).strip(),
                "codSap": (
                    str(primary_rc_material.get("codSap", "")).strip()
                    if primary_rc_material
                    else str(payload.get("codSap", "")).strip()
                ),
                "material": (
                    str(primary_rc_material.get("material", "")).strip()
                    if primary_rc_material
                    else str(payload.get("material", "")).strip()
                ),
                "rcMateriais": rc_materiais,
                "materiais": payload.get("materiais")
                if isinstance(payload.get("materiais"), list)
                else [],
                "descricao": _required_text(payload, "descricao", "a descrição da tarefa"),
                "anexos": payload.get("anexos")
                if isinstance(payload.get("anexos"), list)
                else [],
            }
            state["forms"].append(form)

            can_create_request = bool(payload.get("canCreateRequest"))
            duplicate_request = any(
                request.get("nome") == form["nome"]
                and request.get("demanda") == demand.get("nome")
                and request.get("departamento") == department.get("nome")
                for request in state["requests"]
            )
            if can_create_request and not duplicate_request:
                state["requests"].append(
                    {
                        "id": str(uuid4()),
                        "requestId": _next_request_id(state["requests"]),
                        "nome": form["responsavel"],
                        "responsavel": form["responsavel"],
                        "material": form["material"],
                        "descricao": form["descricao"],
                        "departamento": department.get("nome") or "Sem departamento",
                        "demanda": demand.get("nome") or "Sem demanda",
                        "centroCusto": form["centroCusto"],
                        "codSap": form["codSap"] or "—",
                        "rcMateriais": rc_materiais,
                        "materiais": form["materiais"],
                        "anexos": form["anexos"],
                        "slaDias": demand.get("sla") or 1,
                        "dataSolicitacao": date.today().isoformat(),
                        "dataInicio": "",
                        "dataFim": "",
                        "retornoAdm": "",
                        "status": "nao_iniciado",
                    }
                )

            result = _write_state(connection, state)
            connection.commit()
            return result
        except Exception:
            connection.rollback()
            raise


def _storage_error(exc: Exception) -> HTTPException:
    LOGGER.exception("Falha ao acessar o estado das solicitações")
    return HTTPException(
        status_code=500,
        detail="Não foi possível acessar o armazenamento das solicitações. Consulte o log do servidor.",
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(TEMPLATE_DIR / "solicitacoes.html")


@app.get("/solicitacoes")
def solicitacoes() -> FileResponse:
    return FileResponse(TEMPLATE_DIR / "solicitacoes.html")


@app.get("/api/solicitacoes-state")
def get_state():
    try:
        return load_state()
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        raise _storage_error(exc) from exc


@app.post("/api/solicitacoes-state")
def set_state(payload: dict):
    try:
        return save_state(payload)
    except StateConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        raise _storage_error(exc) from exc


@app.post("/api/solicitacoes-state/forms")
def add_form(payload: dict):
    try:
        return create_form(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        raise _storage_error(exc) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("appsolicitações:app", host="0.0.0.0", port=8000, reload=True)
