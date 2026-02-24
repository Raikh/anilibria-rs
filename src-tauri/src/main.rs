#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimeName {
    pub main: String,
    pub english: Option<String>,
    pub alternative: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimePoster {
    pub src: String,
    pub preview: String,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Genre {
    pub id: Option<u64>,
    pub name: String,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Episode {
    pub episode: u32,
    pub name: Option<String>,
    pub uuid: String,
    pub hls: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Player {
    pub host: String,
    pub list: serde_json::Value,
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Anime {
    pub id: u64,
    pub name: AnimeName,
    pub poster: AnimePoster,
    pub year: Option<u32>,
    pub description: Option<String>,
    pub genres: Option<Vec<Genre>>,
    pub player: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    data: Vec<Anime>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AppSettings {
    pub api_url: String,
}

pub struct ConfigState(pub std::sync::Mutex<AppSettings>);

#[tauri::command]
async fn get_catalog(state: tauri::State<'_, ConfigState>) -> Result<Vec<Anime>, String> {
    let base_url: String = state.0.lock().unwrap().api_url.clone();

    let url: String = format!("{}/anime/releases/latest?limit=15", base_url);

    let client: Client = reqwest::Client::new();
    let response: reqwest::Response = client
        .get(&url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e: reqwest::Error| format!("Ошибка сети: {}", e))?;

    if response.status().is_success() {
        let data: Vec<Anime> = response
            .json()
            .await
            .map_err(|e: reqwest::Error| format!("Ошибка парсинга последних релизов: {}", e))?;

        Ok(data)
    } else {
        Err(format!("Сервер вернул статус: {}", response.status()))
    }
}

#[tauri::command]
async fn get_catalog_paginated(
    state: tauri::State<'_, ConfigState>,
    page: u32,
) -> Result<Vec<Anime>, String> {
    let base_url = state.0.lock().unwrap().api_url.clone();
    let limit: i32 = 15;

    let api_page: u32 = page + 1;

    let url: String = format!(
        "{}/anime/catalog/releases?limit={}&page={}",
        base_url, limit, api_page
    );

    let client: Client = reqwest::Client::new();
    let response: reqwest::Response = client
        .get(&url)
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if response.status().is_success() {
        let res_body: ApiResponse = response.json().await.map_err(|e: reqwest::Error| {
            format!("Ошибка парсинга JSON: {}. Проверьте структуру Anime", e)
        })?;
        Ok(res_body.data)
    } else {
        Err(format!("Ошибка сервера: {}", response.status()))
    }
}

#[tauri::command]
async fn get_anime_details(
    state: tauri::State<'_, ConfigState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let base_url: String = state.0.lock().unwrap().api_url.clone();
    let url: String = format!("{}/anime/releases/episodes/{}", base_url, id);

    let client: Client = reqwest::Client::new();
    let response: reqwest::Response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Tauri App)")
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка API: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn get_full_release(id: String) -> Result<serde_json::Value, String> {
    let url: String = format!("https://anilibria.top/api/v1/anime/releases/{}", id);

    let client: Client = reqwest::Client::new();
    let response: reqwest::Response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка API: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn search_releases(
    state: tauri::State<'_, ConfigState>,
    query: String,
) -> Result<Vec<Anime>, String> {
    let base_url: String = state.0.lock().unwrap().api_url.clone();

    let url: String = format!("{}/app/search/releases", base_url);

    let client: Client = reqwest::Client::new();
    let response: reqwest::Response = client
        .get(&url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .header("Accept", "application/json")
        .query(&[("query", query.as_str())])
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if response.status().is_success() {
        let body_text: String = response
            .text()
            .await
            .map_err(|e: reqwest::Error| e.to_string())?;

        let data: Vec<Anime> =
            serde_json::from_str(&body_text).map_err(|e: serde_json::Error| {
                format!(
                    "Ошибка десериализации списка: {}. Тело ответа: {}",
                    e, body_text
                )
            })?;

        Ok(data)
    } else {
        Err(format!("Ошибка API: {}", response.status()))
    }
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, ConfigState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    let mut config: std::sync::MutexGuard<'_, AppSettings> = state.0.lock().unwrap();
    config.api_url = new_settings.api_url;

    // TODO: Хранить настройки в файле или БД

    println!("Настройки обновлены: {}", config.api_url);
    Ok(())
}

#[tauri::command]
fn get_settings(state: tauri::State<ConfigState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app: &mut tauri::App| {
            let initial_settings: AppSettings = AppSettings {
                api_url: "https://anilibria.top/api/v1".into(),
            };

            app.manage(ConfigState(std::sync::Mutex::new(initial_settings)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_catalog,
            get_catalog_paginated,
            get_anime_details,
            get_full_release,
            search_releases,
            save_settings,
            get_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
