from __future__ import annotations

import logging
import os

import requests
from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.utils.dates import days_ago


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"Missing required env var: {name}")
    return value


def trigger_radar_regenerate() -> None:
    base_url = _required_env("RADAR_API_BASE_URL").rstrip("/")
    username = _required_env("RADAR_ADMIN_USERNAME")
    password = _required_env("RADAR_ADMIN_PASSWORD")
    table_name = os.environ.get("RADAR_TABLE_NAME")
    timeout_s = float(os.environ.get("RADAR_TIMEOUT_S", "900"))

    logging.info("Radar regenerate request starting (table_name=%s).", table_name or "ALL")

    login_res = requests.post(
        f"{base_url}/auth/login",
        json={"username": username, "password": password},
        timeout=timeout_s,
    )
    login_res.raise_for_status()
    login_payload = login_res.json()
    token = login_payload.get("access_token")
    token_type = login_payload.get("token_type")
    if not token or not token_type:
        raise ValueError("Login response missing access_token or token_type.")

    regen_res = requests.post(
        f"{base_url}/loop/regenerate",
        headers={"Authorization": f"{token_type} {token}"},
        params={"table_name": table_name} if table_name else None,
        timeout=timeout_s,
    )
    regen_res.raise_for_status()
    regen_payload = regen_res.json()
    items = regen_payload.get("items")
    if items is None:
        raise ValueError("Regenerate response missing items.")

    logging.info("Radar regenerate completed (%s tables).", len(items))


with DAG(
    dag_id="radar_regenerate",
    start_date=days_ago(1),
    schedule="@daily",
    catchup=False,
    tags=["radar"],
) as dag:
    PythonOperator(
        task_id="trigger_radar_regenerate",
        python_callable=trigger_radar_regenerate,
    )
