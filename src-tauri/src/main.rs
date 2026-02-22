#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use reqwest::Client;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimeName {
    pub main: String,
    pub english: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnimePoster {
    pub src: String,
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
    pub data: Vec<Anime>,
}

async fn fetch_from_api() -> Result<Vec<Anime>, String> {
    let client = Client::new();

    let url = "https://anilibria.top/api/v1/anime/catalog/releases?limit=12";

    let response = client.get(url)
        .header("User-Agent", "AniLibrix-Rust-Client")
        .header("Accept", "application/json") // Явно просим JSON
        .send()
        .await
        .map_err(|e| format!("Ошибка сети: {}", e))?;

    if response.status().is_success() {
        let body = response.text().await.map_err(|e| e.to_string())?;

        let res: ApiResponse = serde_json::from_str(&body).map_err(|e| {
            println!("Ошибка парсинга! Тело ответа: {}", body);
            format!("Ошибка структуры JSON: {}", e)
        })?;

        Ok(res.data)
    } else {
        Err(format!("Сервер вернул статус: {}", response.status()))
    }
}

#[tauri::command]
async fn get_catalog() -> Result<Vec<Anime>, String> {
    fetch_from_api().await
}

#[tauri::command]
async fn get_anime_details(id: String) -> Result<serde_json::Value, String> {
    let url = format!("https://anilibria.top/api/v1/anime/releases/episodes/{}", id);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("User-Agent", "Mozilla/5.0 (Tauri App)")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка API: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

#[tauri::command]
async fn get_full_release(id: String) -> Result<serde_json::Value, String> {
    let url = format!("https://anilibria.top/api/v1/anime/releases/{}", id);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Ошибка API: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_catalog,
            get_anime_details,
            get_full_release
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
