#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;

// --- Структуры данных (без изменений) ---

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub api_url: String,
}

// --- Состояние приложения ---
// Теперь здесь хранится и клиент, и настройки
pub struct AppState {
    pub config: std::sync::Mutex<AppSettings>,
    pub client: Client,
}

// Хелпер для получения базового URL (чтобы не писать lock каждый раз)
impl AppState {
    fn get_api_url(&self) -> String {
        self.config.lock().unwrap().api_url.clone()
    }
}

// --- Команды ---

#[tauri::command]
async fn get_catalog(state: tauri::State<'_, AppState>) -> Result<Vec<Anime>, String> {
    let url = format!("{}/anime/releases/latest?limit=15", state.get_api_url());

    let response: reqwest::Response = state
        .client
        .get(&url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .send()
        .await
        .map_err(|e: reqwest::Error| format!("Ошибка сети: {}", e))?;

    response
        .json::<Vec<Anime>>()
        .await
        .map_err(|e: reqwest::Error| format!("Ошибка парсинга последних релизов: {}", e))
}

#[tauri::command]
async fn get_catalog_paginated(
    state: tauri::State<'_, AppState>,
    page: u32,
) -> Result<Vec<Anime>, String> {
    let api_page: u32 = page + 1;
    let url: String = format!(
        "{}/anime/catalog/releases?limit=15&page={}",
        state.get_api_url(),
        api_page
    );

    let response: reqwest::Response = state
        .client
        .get(&url)
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    let res_body: ApiResponse = response
        .json()
        .await
        .map_err(|e: reqwest::Error| format!("Ошибка парсинга JSON: {}", e))?;

    Ok(res_body.data)
}

#[tauri::command]
async fn get_anime_details(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let url: String = format!("{}/anime/releases/episodes/{}", state.get_api_url(), id);

    let response: reqwest::Response = state
        .client
        .get(&url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка API: {}", response.status()));
    }

    response
        .json()
        .await
        .map_err(|e: reqwest::Error| e.to_string())
}

#[tauri::command]
async fn get_full_release(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let api_url = state.get_api_url();

    // 1. Запрос основного релиза
    let release_url = format!("{}/anime/releases/{}", api_url, id);
    let release_resp = state.client.get(&release_url).send().await
        .map_err(|e| e.to_string())?;
    let mut release_json: serde_json::Value = release_resp.json().await
        .map_err(|e| e.to_string())?;

    // 2. Запрос франшизы (исправленный эндпоинт)
    let franchise_url = format!("{}/anime/franchises/release/{}", api_url, id);
    let franchise_resp = state.client.get(&franchise_url).send().await;

    let mut franchise_data = serde_json::json!([]);

    if let Ok(resp) = franchise_resp {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            // API Anilibria обычно возвращает объект, где список лежит в "releases"
            // или массив объектов. Проверим структуру.
            franchise_data = json;
        }
    }

    // Добавляем во франшизу данные
    if let Some(obj) = release_json.as_object_mut() {
        obj.insert("related_franchise".to_string(), franchise_data);
    }

    Ok(release_json)
}

#[tauri::command]
async fn search_releases(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<Anime>, String> {
    let url: String = format!("{}/app/search/releases", state.get_api_url());

    let response: reqwest::Response = state
        .client
        .get(&url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .query(&[("query", query.as_str())])
        .send()
        .await
        .map_err(|e: reqwest::Error| e.to_string())?;

    if response.status().is_success() {
        response
            .json::<Vec<Anime>>()
            .await
            .map_err(|e| format!("Ошибка десериализации списка: {}", e))
    } else {
        Err(format!("Ошибка API: {}", response.status()))
    }
}

#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, AppState>,
    new_settings: AppSettings,
) -> Result<(), String> {
    let mut config: std::sync::MutexGuard<'_, AppSettings> = state.config.lock().unwrap();
    config.api_url = new_settings.api_url;
    Ok(())
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> AppSettings {
    state.config.lock().unwrap().clone()
}

fn main() {
    // Создаем клиент один раз при запуске.
    // Настраиваем его (таймауты, куки и т.д.) здесь.
    let http_client: Client = Client::builder()
        .user_agent("AniLibrix-Rust-Client")
        .build()
        .expect("Failed to create HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(move |app: &mut tauri::App| {
            let initial_settings: AppSettings = AppSettings {
                api_url: "https://anilibria.top/api/v1".into(),
            };

            // Передаем клиент и настройки в общее состояние
            app.manage(AppState {
                config: std::sync::Mutex::new(initial_settings),
                client: http_client,
            });
            for _window in app.webview_windows().values() {
                #[cfg(debug_assertions)]
                let _ = _window.open_devtools();
            }
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
