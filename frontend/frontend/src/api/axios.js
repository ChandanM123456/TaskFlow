import axios from "axios";

const API = axios.create({
  baseURL: "http://127.0.0.1:8000/api",
});

API.interceptors.request.use((req) => {
  const token = localStorage.getItem("access");
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// 🔁 Sync localStorage to backend (Render PGSQL or local SQLite)
export const syncLocalToRemote = async () => {
  const token = localStorage.getItem("access");
  if (!token) return;

  const headers = { Authorization: `Bearer ${token}` };

  // Sync task code
  for (let key in localStorage) {
    if (key.startsWith("scrumio_task_code_")) {
      try {
        const raw = localStorage.getItem(key);
        const taskId = key.replace("scrumio_task_code_", "");
        const payload = JSON.parse(raw);

        await API.post(`/tasks/${taskId}/code/`, {
          file_structure: payload.file_structure || [],
          code_content: payload.code_content || "",
          language: payload.language || "javascript",
          saved_at: new Date().toISOString(),
        }, { headers });
      } catch (err) {
        console.error("Sync failed for", key, err);
      }
    }
  }

  // Sync telemetry buffer
  try {
    const telemetry = JSON.parse(localStorage.getItem("telemetry_buffer_v2") || "[]");
    if (telemetry.length) {
      await API.post("/events/batch/", {
        session: Math.random().toString(36).slice(2),
        events: telemetry,
      }, { headers });
    }
  } catch (err) {
    console.error("Telemetry sync failed", err);
  }
};

export default API;
