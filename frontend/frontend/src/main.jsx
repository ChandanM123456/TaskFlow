import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import "./style.css";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import * as XLSX from "xlsx";
import Editor from "@monaco-editor/react";

import {
  Chart,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  Filler,
} from "chart.js";
import { Pie, Bar, Line } from "react-chartjs-2";

/**
 * main.jsx — Scrum.io
 * - Fix: Hooks order issue by avoiding hooks after conditional returns.
 * - Fix: Telemetry 404 silenced with runtime disable; hides Flush button if endpoint unavailable.
 * - Meetings: title+link required; employees see compact list; SMs can still add agenda/times.
 * - About and Contact: separate tabs, visible to both roles.
 * - Analytics: compact dashboard for both roles with KPIs + charts; added throughput + time charts, proactive suggestions.
 * - Assistant tab: context-aware chatbot as a dedicated sidebar tab for Employees (no floating dock).
 * - Employees tab: hidden for Employees; visible for Scrum Masters only.
 * - Notifications: auto-dismiss with optional manual close.
 * - Behavioral capture: logs for task moves, edits, approvals, code actions, navigation, searches, time-on-task, data upload/query.
 * - All original logic preserved: PASS→Done, Request Changes→TODO, manual save editor, code badge.
 */

Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  LineElement,
  PointElement,
  Filler
);

const api = axios.create({ baseURL: "http://127.0.0.1:8000/api/" });
api.interceptors.request.use((config) => {
  const t = localStorage.getItem("access_token");
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

/* ===========================
   Telemetry (client buffer) with runtime disable
   =========================== */
const Telemetry = (() => {
  const KEY = "telemetry_buffer_v2";
  const SESSION_KEY = "telemetry_session_id";
  const BUF_MAX = 2000;
  const FLUSH_INTERVAL = 5000;

  let enabled = true;
  let intervalId = null;

  const getSession = () => {
    let s = sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = Math.random().toString(36).slice(2);
      sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  };
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  };
  const save = (arr) => localStorage.setItem(KEY, JSON.stringify(arr.slice(-BUF_MAX)));
  let buffer = load();

  const enqueue = (event) => {
    buffer.push(event);
    save(buffer);
  };

  const flush = async () => {
    if (!enabled) return;
    if (!buffer.length) return;
    const batch = buffer.slice(0, 200);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/events/batch/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("access_token")
            ? { Authorization: `Bearer ${localStorage.getItem("access_token")}` }
            : {}),
        },
        body: JSON.stringify({ session: getSession(), events: batch }),
      });
      if (!res.ok) {
        enabled = false;
        if (intervalId) clearInterval(intervalId);
        return;
      }
      buffer = buffer.slice(batch.length);
      save(buffer);
    } catch {
      enabled = false;
      if (intervalId) clearInterval(intervalId);
    }
  };

  intervalId = setInterval(flush, FLUSH_INTERVAL);

  const log = (type, data = {}) => {
    const username = localStorage.getItem("username");
    const evt = {
      id: Math.random().toString(36).slice(2),
      at: new Date().toISOString(),
      type,
      session: getSession(),
      user: username || null,
      data,
    };
    enqueue(evt);
  };

  const getBuffered = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  };

  const isEnabled = () => enabled;

  return { log, flush, getBuffered, isEnabled };
})();

/* ===========================
   Time on Task hook
   =========================== */
const useTimeOnTask = (taskId, enabled) => {
  const state = useRef({ start: null, taskId });
  const start = () => {
    if (!enabled || state.current.start) return;
    state.current.start = Date.now();
  };
  const stop = (reason = "stop") => {
    const s = state.current.start;
    if (!enabled || !s) return;
    const ms = Date.now() - s;
    state.current.start = null;
    Telemetry.log("time_spent", { taskId: state.current.taskId, ms, reason });
  };

  useEffect(() => {
    if (!enabled) return;
    start();
    const onVis = () => (document.hidden ? stop("visibility_change") : start());
    const onBlur = () => stop("window_blur");
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop("unmount");
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line
  }, [taskId, enabled]);

  return { start, stop };
};

/* ===========================
   Local code "DB" (localStorage)
   =========================== */
const LocalRepo = {
  key(taskId) {
    return `scrumio_task_code_${taskId}`;
  },
  save(taskId, payload) {
    const data = {
      file_structure: payload.file_structure || [],
      code_content: payload.code_content || "",
      language: payload.language || "javascript",
      saved_at: new Date().toISOString(),
    };
    localStorage.setItem(this.key(taskId), JSON.stringify(data));
    return data;
  },
  load(taskId) {
    try {
      const raw = localStorage.getItem(this.key(taskId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.file_structure)) data.file_structure = [];
      data.code_content = data.code_content || "";
      data.language = data.language || "javascript";
      return data;
    } catch {
      return null;
    }
  },
  remove(taskId) {
    localStorage.removeItem(this.key(taskId));
  },
};

/* ===========================
   Utils
   =========================== */
const SafeParseJson = (val) => {
  try {
    if (!val) return null;
    if (typeof val === "string") return JSON.parse(val);
    return val;
  } catch {
    return null;
  }
};
const stringifyTree = (tree) => {
  try {
    return JSON.stringify(tree || []);
  } catch {
    return "[]";
  }
};
const pathJoin = (a, b) => (a ? `${a}/${b}` : b);

/* ===========================
   UI helpers
   =========================== */
const Loader = () => <p className="loader">Loading...</p>;

const StatusBadge = ({ status }) => {
  const className = useMemo(() => {
    switch (status) {
      case "TODO":
        return "status-todo";
      case "IN_PROGRESS":
        return "status-inprogress";
      case "REVIEW":
        return "status-codereview";
      case "PASS":
        return "status-pass";
      case "FAIL":
        return "status-fail";
      case "DONE":
        return "status-done";
      default:
        return "";
    }
  }, [status]);

  const displayStatus = useMemo(() => {
    switch (status) {
      case "TODO":
        return "To Do";
      case "IN_PROGRESS":
        return "In Progress";
      case "REVIEW":
        return "In Review";
      case "PASS":
        return "Passed";
      case "FAIL":
        return "Failed";
      case "DONE":
        return "Done";
      default:
        return "";
    }
  }, [status]);

  return <span className={`status-badge ${className}`}>{displayStatus}</span>;
};

const DeadlineBadge = ({ deadline }) => {
  if (!deadline) return null;
  const now = new Date();
  const dueDate = new Date(deadline);
  const diffTime = dueDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    return (
      <span className="deadline-badge deadline-overdue">
        {Math.abs(diffDays)} days over 🚨
      </span>
    );
  } else if (diffDays <= 3) {
    return (
      <span className="deadline-badge deadline-upcoming">
        {diffDays} days left ⏳
      </span>
    );
  }
  return null;
};

/* ===========================
   File tree
   =========================== */
const RepoContextMenu = ({ x, y, onRename, onDelete, onClose }) => (
  <div className="context-menu" style={{ top: y, left: x }} onMouseLeave={onClose}>
    <button onClick={onRename}>Rename</button>
    <button onClick={onDelete}>Delete</button>
  </div>
);

const FileTreeItem = ({
  item,
  path,
  activeFile,
  onFileClick,
  depth = 0,
  onAddFileHere,
  onAddFolderHere,
  onRename,
  onDelete,
  showContext = true,
}) => {
  const fullPath = path ? `${path}/${item.name}` : item.name;
  const isFile = !item.children;
  const isActive = activeFile === fullPath;
  const [menu, setMenu] = useState(null);

  const handleClick = () => {
    if (isFile) onFileClick(fullPath, item.content);
  };

  const handleContext = (e) => {
    if (!showContext) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="file-tree-item" style={{ paddingLeft: `${depth * 14}px` }}>
      <div
        className={`file-tree-node ${isActive ? "active" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContext}
      >
        <span className="file-icon">{isFile ? "📄" : "📁"}</span>
        <span className="file-name">{item.name}</span>
        {!isFile && (
          <span className="folder-actions">
            <button
              className="tiny-btn"
              title="New file"
              onClick={(e) => {
                e.stopPropagation();
                onAddFileHere(fullPath);
              }}
            >
              +f
            </button>
            <button
              className="tiny-btn"
              title="New folder"
              onClick={(e) => {
                e.stopPropagation();
                onAddFolderHere(fullPath);
              }}
            >
              +d
            </button>
          </span>
        )}
      </div>
      {menu && (
        <RepoContextMenu
          x={menu.x}
          y={menu.y}
          onRename={() => {
            setMenu(null);
            onRename(fullPath);
          }}
          onDelete={() => {
            setMenu(null);
            onDelete(fullPath);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {item.children && (
        <div className="file-tree-children">
          {item.children.map((child, index) => (
            <FileTreeItem
              key={index}
              item={child}
              path={fullPath}
              activeFile={activeFile}
              onFileClick={onFileClick}
              depth={depth + 1}
              onAddFileHere={onAddFileHere}
              onAddFolderHere={onAddFolderHere}
              onRename={onRename}
              onDelete={onDelete}
              showContext={showContext}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTreeView = ({
  files,
  activeFile,
  onFileClick,
  onAddFileRoot,
  onAddFolderRoot,
  onAddFileHere,
  onAddFolderHere,
  onRename,
  onDelete,
  readonly = false,
}) => (
  <div className="file-tree">
    <div className="file-tree-header">
      <h4>Explorer</h4>
      {!readonly && (
        <div className="file-tree-actions">
          <button className="tree-action-btn" onClick={onAddFileRoot} title="Add File">
            + File
          </button>
          <button className="tree-action-btn" onClick={onAddFolderRoot} title="Add Folder">
            + Folder
          </button>
        </div>
      )}
    </div>
    <div className="file-tree-content">
      {files.length === 0 ? (
        <p className="empty-tree">No files. Initialize a repository to get started.</p>
      ) : (
        files.map((item, index) => (
          <FileTreeItem
            key={index}
            item={item}
            path=""
            activeFile={activeFile}
            onFileClick={onFileClick}
            onAddFileHere={onAddFileHere}
            onAddFolderHere={onAddFolderHere}
            onRename={onRename}
            onDelete={onDelete}
            showContext={!readonly}
          />
        ))
      )}
    </div>
  </div>
);

/* ===========================
   Code Viewer (merges local code)
   =========================== */
const mergeLocalIntoTask = (task) => {
  const local = LocalRepo.load(task.id);
  if (!local) return task;
  return {
    ...task,
    file_structure: stringifyTree(local.file_structure),
    code_content: local.code_content,
    code_language: local.language || "javascript",
    local_saved_at: local.saved_at,
  };
};

const CodeViewerModal = ({ task, onClose }) => {
  const taskWithLocal = useMemo(() => mergeLocalIntoTask(task), [task]);
  const [activeFile, setActiveFile] = useState(null);
  const [codeContent, setCodeContent] = useState(taskWithLocal.code_content || "");
  const [fileStructure, setFileStructure] = useState(SafeParseJson(taskWithLocal.file_structure) || []);

  useEffect(() => {
    const tree = SafeParseJson(taskWithLocal.file_structure) || [];
    setFileStructure(tree);
    setCodeContent(taskWithLocal.code_content || "");
    const pickFirstFile = (nodes, p = "") => {
      for (const n of nodes) {
        const full = p ? `${p}/${n.name}` : n.name;
        if (!n.children) return full;
        const deep = pickFirstFile(n.children, full);
        if (deep) return deep;
      }
      return null;
    };
    setActiveFile(pickFirstFile(tree));
  }, [taskWithLocal]);

  const getContentForActiveFile = useCallback(() => {
    if (!activeFile) return codeContent || "";
    const findRec = (nodes, p = "") => {
      for (const node of nodes) {
        const full = p ? `${p}/${node.name}` : node.name;
        if (full === activeFile && !node.children) return node.content || "";
        if (node.children) {
          const deep = findRec(node.children, full);
          if (deep !== undefined) return deep;
        }
      }
      return undefined;
    };
    const found = findRec(fileStructure, "");
    if (found !== undefined) return found;
    return codeContent || "";
  }, [activeFile, codeContent, fileStructure]);

  const treeHasFiles = (fileStructure || []).length > 0;

  return (
    <div className="modal-overlay" onClick={(e) => e.target.classList.contains("modal-overlay") && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>View Code: {task.title}</h3>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="code-review">
          <div className="review-sidebar">
            <h4>Repo</h4>
            {treeHasFiles ? (
              <FileTreeView
                files={fileStructure}
                activeFile={activeFile}
                onFileClick={(path) => setActiveFile(path)}
                onAddFileRoot={() => {}}
                onAddFolderRoot={() => {}}
                onAddFileHere={() => {}}
                onAddFolderHere={() => {}}
                onRename={() => {}}
                onDelete={() => {}}
                readonly
              />
            ) : (
              <div className="repo-empty">
                <p>No repository tree. Single-file submission:</p>
                <code className="single-file-name">/code_content</code>
              </div>
            )}
          </div>

          <div className="review-main">
            <div className="review-code-header">
              <div className="file-label">{activeFile || "/code_content"}</div>
              <StatusBadge status={task.status} />
            </div>
            <div className="review-code-view">
              <Editor
                height="420px"
                language={taskWithLocal.code_language || "javascript"}
                value={getContentForActiveFile()}
                onChange={() => {}}
                theme="vs-dark"
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 14 }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ===========================
   Employees
   =========================== */
const EmployeeCard = ({
  emp,
  editEmployee,
  setEditEmployee,
  handleSaveEdit,
  handleDeleteEmployee,
  tasks,
  onEmployeeClick,
}) => {
  const empTasks = useMemo(
    () => tasks.filter((t) => t.assigned_to === emp.id),
    [tasks, emp.id]
  );
  const completed = useMemo(
    () => empTasks.filter((t) => t.status === "DONE" || t.status === "PASS").length,
    [empTasks]
  );
  const total = empTasks.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div key={emp.id} className="employee-card">
      {editEmployee && editEmployee.id === emp.id ? (
        <>
          <input
            type="text"
            value={editEmployee.username}
            onChange={(e) =>
              setEditEmployee({ ...editEmployee, username: e.target.value })
            }
          />
          <div className="task-buttons">
            <button className="big-btn save-btn" onClick={handleSaveEdit}>
              Save
            </button>
            <button
              className="big-btn cancel-btn"
              onClick={() => setEditEmployee(null)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>{emp.username}</h3>
          <p>Tasks assigned: {total}</p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="task-buttons">
            <button className="view-btn" onClick={() => onEmployeeClick(emp)}>
              View Tasks
            </button>
            <button className="edit-btn" onClick={() => setEditEmployee(emp)}>
              Edit
            </button>
            <button
              className="delete-btn"
              onClick={() => handleDeleteEmployee(emp.id)}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/* ===========================
   Meetings Types & UI helpers
   =========================== */
const isValidUrl = (s) => {
  try {
    const u = new URL(s);
    return !!u.protocol && !!u.host;
  } catch {
    return false;
  }
};

const defaultMeeting = () => ({
  title: "",
  agenda: "",
  starts_at: "",
  ends_at: "",
  link: "",
});

/* ===========================
   Chatbot (Employee-only) — Page mode
   =========================== */
const ChatMessage = ({ from, text }) => (
  <div className={`chat-row ${from === "bot" ? "from-bot" : "from-me"}`}>
    <div className="chat-bubble">{text}</div>
  </div>
);

const Chatbot = ({ role, tasks, meetings }) => {
  const STORAGE_KEY = "scrumio_emp_chatbot_v1";
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  const send = (text) => {
    if (!text.trim()) return;
    const me = { id: Math.random().toString(36).slice(2), from: "me", text, at: Date.now() };
    setMessages((prev) => [...prev, me]);

    const lower = text.toLowerCase();
    let reply = "";

    if (lower.includes("submit") && lower.includes("review")) {
      reply =
        "To submit a task for review: open the task, code in the editor, click Save (💾), then click Submit for Review (🚀). The Scrum Master will see it under In Review.";
    } else if (lower.includes("pass") || lower.includes("approve")) {
      reply =
        "Approve sets status to PASS. It still shows under Done in the board and appears under Passed in Project Status.";
    } else if (lower.includes("request") && lower.includes("changes")) {
      reply =
        "Request Changes moves the task back to TODO with feedback. Pick it up, fix, save, and resubmit for review.";
    } else if (lower.includes("meeting") || lower.includes("join")) {
      const upcoming = (meetings || []).slice(0, 3).map((m) => `• ${m.title} — Join: ${m.link || "N/A"}`).join("\n");
      reply =
        upcoming || "No meetings found. When a meeting is scheduled, you’ll see a Join button on the Meetings tab.";
    } else if (lower.includes("my tasks")) {
      const me = localStorage.getItem("username");
      const mine = tasks.filter((t) => t.assigned_to_username === me);
      reply =
        mine.length > 0
          ? `You have ${mine.length} tasks. Examples:\n${mine
              .slice(0, 3)
              .map((t) => `• ${t.title} [${t.status}]`)
              .join("\n")}`
          : "You have no tasks assigned right now.";
    } else if (lower.includes("role")) {
      const roleMsg =
        role === "EMPLOYEE"
          ? "You’re an Employee: pick up tasks, write code, save manually, and submit for review."
          : "You’re a Scrum Master: assign tasks, review submissions, approve (PASS) or request changes, and manage meetings.";
      reply = roleMsg;
    } else if (lower.includes("help")) {
      reply =
        "Try asking: 'How do I submit for review?', 'What does PASS mean?', 'Show my meetings', or 'Show my tasks'.";
    } else {
      reply =
        "Not sure I got that. Try 'help' for ideas, or ask about submitting reviews, PASS, meetings, or your tasks.";
    }

    const bot = { id: Math.random().toString(36).slice(2), from: "bot", text: reply, at: Date.now() };
    setTimeout(() => setMessages((prev) => [...prev, bot]), 180);
  };

  if (role !== "EMPLOYEE") return null;

  return (
    <div className="assistant-page">
      <div className="chatbot-panel open">
        <div className="chatbot-header">
          <strong>Assistant</strong>
          <span className="muted">Ask about tasks, reviews, roles, or meetings</span>
        </div>
        <div className="chatbot-suggestions">
          <button onClick={() => send("How do I submit for review?")}>Submit for review</button>
          <button onClick={() => send("What does PASS mean?")}>PASS meaning</button>
          <button onClick={() => send("Show my meetings")}>My meetings</button>
          <button onClick={() => send("Show my tasks")}>My tasks</button>
        </div>
        <div className="chatbot-messages">
          {messages.map((m) => (
            <ChatMessage key={m.id} from={m.from} text={m.text} />
          ))}
        </div>
        <div className="chatbot-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (send(input), setInput(""))}
            placeholder="Type a message..."
          />
          <button
            onClick={() => {
              send(input);
              setInput("");
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

/* ===========================
   Main App
   =========================== */
function App() {
  const [role, setRole] = useState(localStorage.getItem("role") || null);
  const [loginRole, setLoginRole] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [registerData, setRegisterData] = useState({ username: "", password: "" });

  const [activeTab, setActiveTab] = useState("tasks");
  const [error, setError] = useState(null);

  // Notifications with auto-dismiss
  const [notifications, setNotifications] = useState([]);
  const removeNotificationAt = (index) =>
    setNotifications((prev) => prev.filter((_, i) => i !== index));
  const NotificationItem = ({ text, onClose }) => {
    useEffect(() => {
      const t = setTimeout(onClose, 4000);
      return () => clearTimeout(t);
    }, [onClose]);
    return (
      <p className="notification">
        {text}
        <button
          className="notif-close"
          onClick={onClose}
          title="Dismiss"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </p>
    );
  };

  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);

  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    assigned_to: "",
    status: "TODO",
    deadline: "",
  });
  const [searchTerm, setSearchTerm] = useState("");

  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ username: "", password: "" });
  const [editEmployee, setEditEmployee] = useState(null);
  const [searchEmployee, setSearchEmployee] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Platform
  const [activePane, setActivePane] = useState("code"); // 'code' | 'data-analytics'
  const [codeContent, setCodeContent] = useState("// Write your code here...");
  const [codeLanguage, setCodeLanguage] = useState("javascript");
  const [codeOutput, setCodeOutput] = useState("");
  const [activeTaskForCoding, setActiveTaskForCoding] = useState(null);

  const [fileStructure, setFileStructure] = useState([]);
  const [activeFile, setActiveFile] = useState(null);

  // Data Analytics
  const [excelData, setExcelData] = useState([]);
  const [query, setQuery] = useState("");
  const [queryOutput, setQueryOutput] = useState([]);

  // Viewer modals
  const [showScrumMasterCodeView, setShowScrumMasterCodeView] = useState(false);
  const [taskForCodeReview, setTaskForCodeReview] = useState(null);
  const [showEmployeeCodeView, setShowEmployeeCodeView] = useState(false);
  const [taskForEmployeeView, setTaskForEmployeeView] = useState(null);

  // Calendar
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Meetings
  const [meetings, setMeetings] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [showAddMeeting, setShowAddMeeting] = useState(false);
  const [newMeeting, setNewMeeting] = useState(defaultMeeting());
  const [editMeetingId, setEditMeetingId] = useState(null);
  const [meetingError, setMeetingError] = useState(null);

  // ---------- API helpers ----------
  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    setError(null);
    try {
      const res = await api.get("tasks/");
      setTasks(res.data);
    } catch {
      setError("Failed to fetch tasks");
    } finally {
      setLoadingTasks(false);
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    setError(null);
    try {
      const res = await api.get("employees/");
      setEmployees(res.data);
    } catch {
      setError("Failed to fetch employees");
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const getTaskById = useCallback(async (id) => {
    try {
      const res = await api.get(`tasks/${id}/`);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  const upsertTaskInState = useCallback((updated) => {
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === updated.id);
      return exists ? prev.map((t) => (t.id === updated.id ? updated : t)) : [updated, ...prev];
    });
  }, []);

  const fetchMeetings = useCallback(async () => {
    setLoadingMeetings(true);
    setMeetingError(null);
    try {
      const res = await api.get("meetings/");
      setMeetings(res.data || []);
    } catch {
      setMeetingError("");
    } finally {
      setLoadingMeetings(false);
    }
  }, []);

  // ---------- Analytics builder (enhanced) ----------
  const buildAnalytics = useCallback((tasksList, events) => {
    const completed = tasksList.filter((t) => t.status === "DONE" || t.status === "PASS").length;
    const pending = tasksList.length - completed;

    const statusCounts = tasksList.reduce((acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      return acc;
    }, {});

    const timeByUserMs = {};
    (events || [])
      .filter((e) => e.type === "time_spent")
      .forEach((e) => {
        const u = e.user || "anonymous";
        timeByUserMs[u] = (timeByUserMs[u] || 0) + (e.data?.ms || 0);
      });

    const throughputByDay = {};
    tasksList.forEach((t) => {
      const d = (t.updated_at || t.created_at || "").slice(0, 10);
      if (!d) return;
      if (t.status === "DONE" || t.status === "PASS") {
        throughputByDay[d] = (throughputByDay[d] || 0) + 1;
      }
    });

    // Behavioral trends
    const todayStr = new Date().toISOString().slice(0, 10);
    const eventsToday = (events || []).filter((e) => (e.at || "").slice(0, 10) === todayStr);
    const contextSwitchesToday = eventsToday.filter((e) =>
      ["nav_switch", "task_move", "code_run"].includes(e.type)
    ).length;

    // Optimal scheduling: sum time_spent per hour of day
    const timePerHour = Array.from({ length: 24 }, () => 0);
    (events || [])
      .filter((e) => e.type === "time_spent")
      .forEach((e) => {
        const hour = new Date(e.at).getHours();
        timePerHour[hour] += e.data?.ms || 0;
      });
    const rankedHours = timePerHour
      .map((ms, hour) => ({ hour, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3);

    return {
      completed,
      pending,
      statusCounts,
      timeByUserMs,
      throughputByDay,
      contextSwitchesToday,
      optimalHours: rankedHours, // top 3 hours by focus time
    };
  }, []);

  const fetchAnalytics = useCallback(() => {
    const events = Telemetry.getBuffered();
    const employeePerformance = employees.map((emp) => {
      const completedTasks = tasks.filter(
        (t) => t.assigned_to === emp.id && (t.status === "DONE" || t.status === "PASS")
      ).length;
      const totalAssignedTasks = tasks.filter((t) => t.assigned_to === emp.id).length;

      const username = emp.username;
      const timeMs = (events || [])
        .filter((e) => e.type === "time_spent" && e.user === username)
        .reduce((acc, e) => acc + (e.data?.ms || 0), 0);
      const timeHrs = Math.round((timeMs / 3600000) * 10) / 10;

      return {
        username: emp.username,
        completed: completedTasks,
        total: totalAssignedTasks,
        completionPercentage:
          totalAssignedTasks > 0 ? (completedTasks / totalAssignedTasks) * 100 : 0,
        timeHrs,
      };
    });

    const kpis = buildAnalytics(tasks, events);

    // Compact default datasets
    const burnDownData = {
      labels: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"],
      ideal: [
        tasks.length,
        tasks.length * 0.8,
        tasks.length * 0.6,
        tasks.length * 0.4,
        tasks.length * 0.2,
      ],
      actual: [
        tasks.length,
        Math.max(0, tasks.length - 2),
        Math.max(0, tasks.length - 5),
        Math.max(0, tasks.length - 7),
        Math.max(0, tasks.length - 10),
      ],
    };

    // Throughput line from kpis
    const throughputLabels = Object.keys(kpis.throughputByDay).sort();
    const throughputData = throughputLabels.map((d) => kpis.throughputByDay[d]);

    setAnalyticsData({
      employeePerformance,
      burnDownData,
      kpis,
      throughputLabels,
      throughputData,
      timeByUserMs: kpis.timeByUserMs,
    });
  }, [employees, tasks, buildAnalytics]);

  // ---------- Effects ----------
  useEffect(() => {
    if (!role) return;
    if (role === "SCRUM_MASTER") {
      fetchEmployees();
      fetchTasks();
      fetchMeetings();
    } else {
      fetchTasks();
      fetchMeetings();
    }
  }, [role, fetchEmployees, fetchTasks, fetchMeetings]);

  useEffect(() => {
    if (role && (tasks.length > 0 || employees.length > 0)) {
      fetchAnalytics();
    }
  }, [tasks, employees, role, fetchAnalytics]);

  // ---------- Auth ----------
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!credentials.username || !credentials.password) {
      setError("Enter username and password");
      return;
    }
    try {
      const res = await api.post("auth/login/", credentials);
      localStorage.setItem("access_token", res.data.access);
      localStorage.setItem("refresh_token", res.data.refresh);
      localStorage.setItem("username", res.data.username);
      setRole(res.data.role);
      localStorage.setItem("role", res.data.role);
      setShowLogin(false);
      setCredentials({ username: "", password: "" });
      Telemetry.log("login", { role: res.data.role });
    } catch (err) {
      const msg = err.response?.data?.detail || "Invalid username or password";
      setError(msg);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!registerData.username || !registerData.password) {
      setError("Enter username and password");
      return;
    }
    try {
      const res = await api.post("auth/register/employee/", registerData);
      localStorage.setItem("access_token", res.data.access);
      localStorage.setItem("refresh_token", res.data.refresh);
      localStorage.setItem("username", res.data.username);
      setRole(res.data.role);
      localStorage.setItem("role", res.data.role);
      setShowRegister(false);
      setRegisterData({ username: "", password: "" });
      Telemetry.log("register", { role: res.data.role });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to register. Try another username.");
    }
  };

  const handleLogout = () => {
    Telemetry.log("logout", { role });
    setRole(null);
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    setTasks([]);
    setEmployees([]);
    setCredentials({ username: "", password: "" });
    setError(null);
    setShowLogin(false);
    setShowRegister(false);
    setShowAddTask(false);
    setActiveTab("tasks");
    setNotifications([]);
  };

  // ---------- Tasks ----------
  const normalizeDeadlineToISO = (dateString) => {
    if (!dateString) return null;
    try {
      const [y, m, d] = dateString.split("-").map((x) => parseInt(x, 10));
      const dt = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 0);
      return dt.toISOString();
    } catch {
      return null;
    }
  };

  const handleAddTaskSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const title = (newTask.title || "").trim();
    if (!title) {
      setError("Title is required");
      return;
    }
    if (role === "SCRUM_MASTER" && !newTask.assigned_to) {
      setError("Please assign the task to an employee.");
      return;
    }

    const payload = {
      title,
      description: (newTask.description || "").trim(),
      status: newTask.status || "TODO",
      deadline: normalizeDeadlineToISO(newTask.deadline),
    };
    if (newTask.assigned_to) payload.assigned_to = Number(newTask.assigned_to);

    try {
      const res = await api.post("tasks/", payload);
      setTasks((prev) => [res.data, ...prev]);
      setNewTask({
        title: "",
        description: "",
        assigned_to: "",
        status: "TODO",
        deadline: "",
      });
      setShowAddTask(false);
      setNotifications((prev) => [...prev, `Task "${res.data.title}" added successfully! 🚀`]);
      Telemetry.log("task_create", { taskId: res.data.id });
    } catch (err) {
      const errorMsg =
        err.response?.data?.assigned_to?.[0] ||
        err.response?.data?.detail ||
        err.response?.data?.error ||
        "Failed to create task";
      setError(errorMsg);
    }
  };

  const handleEditTask = async (task) => {
    const newTitle = window.prompt("Edit Task Title:", task.title);
    if (newTitle === null) return;
    const newDesc = window.prompt("Edit Task Description:", task.description ?? "");
    if (newDesc === null) return;

    let assigned_to_id = task.assigned_to;
    if (role === "SCRUM_MASTER") {
      const employeeUsernames = employees.map((e) => `${e.id}: ${e.username}`).join("\n");
      const pick = window.prompt(
        `Update assigned employee (enter ID):\n${employeeUsernames}`,
        task.assigned_to
      );
      if (pick !== null && pick !== "") assigned_to_id = Number(pick);
      else if (pick === "") assigned_to_id = null;
      else return;
    }

    try {
      const payload = {
        title: (newTitle || "").trim(),
        description: (newDesc || "").trim(),
        assigned_to: assigned_to_id,
        status: task.status,
      };
      const res = await api.put(`tasks/${task.id}/`, payload);
      upsertTaskInState(res.data);
      setNotifications((prev) => [...prev, `Task "${res.data.title}" updated successfully! ✅`]);
      Telemetry.log("task_edit", { taskId: task.id, changes: payload });
    } catch {
      setError("Failed to update task");
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!window.confirm("Delete this task?")) return;
    try {
      await api.delete(`tasks/${taskId}/`);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setNotifications((prev) => [...prev, `Task deleted successfully! 🗑️`]);
      Telemetry.log("task_delete", { taskId });
    } catch {
      setError("Failed to delete task");
    }
  };

  // ---------- Drag & Drop ----------
  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index)
      return;

    const movedTask = tasks.find((t) => t.id.toString() === draggableId);
    if (!movedTask) return;
    const newStatus = destination.droppableId.toUpperCase();
    const from = movedTask.status;

    const allowed = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"];
    if (!allowed.includes(newStatus)) return;

    const optimistic = { ...movedTask, status: newStatus };
    upsertTaskInState(optimistic);
    Telemetry.log("task_move", { taskId: movedTask.id, from, to: newStatus });

    try {
      const res = await api.put(`tasks/${movedTask.id}/`, {
        ...movedTask,
        status: newStatus,
        assigned_to: movedTask.assigned_to,
      });
      upsertTaskInState(res.data);
      setNotifications((prev) => [...prev, `Task status updated to ${newStatus}! ✅`]);
      Telemetry.log("task_status_change", { taskId: movedTask.id, from, to: newStatus });
      const fresh = await getTaskById(movedTask.id);
      if (fresh) upsertTaskInState(fresh);
    } catch {
      setError("Failed to update task status");
      const fresh = await getTaskById(movedTask.id);
      if (fresh) upsertTaskInState(fresh);
    }
  };

  // ---------- Approve / Request Changes ----------
  const handleScrumApprove = async (task) => {
    try {
      const note = window.prompt("Optional approval note:", "Approved");
      const res = await api.patch(`tasks/${task.id}/`, {
        status: "PASS",
        feedback: note || "Approved",
      });
      const updated = res.data;
      upsertTaskInState(updated);
      setNotifications((prev) => [...prev, `Task "${updated.title}" approved.`]);
      Telemetry.log("task_review_approve", { taskId: task.id });
    } catch {
      setError("Failed to approve task");
    }
  };

  const handleScrumRequestChanges = async (task) => {
    try {
      const reason = window.prompt("Reason for changes (required):", "Please fix issues and resubmit.");
      if (!reason) return;
      const res = await api.patch(`tasks/${task.id}/`, {
        status: "TODO",
        feedback: `[Request Changes] ${reason}`,
      });
      upsertTaskInState(res.data);
      setNotifications((prev) => [...prev, `Task "${res.data.title}" moved to TODO with feedback.`]);
      Telemetry.log("task_review_request_changes", { taskId: task.id });
    } catch {
      setError("Failed to request changes");
    }
  };

  // ---------- Code execution ----------
  const handleCodeRun = async (code, language, setOutput, taskId = null, outputMountRef = null) => {
    setOutput("Executing code...");
    Telemetry.log("code_run", { taskId, language });

    if (language === "html" || language === "css" || language === "javascript") {
      const mount = outputMountRef?.current;
      if (mount) {
        mount.innerHTML = "";
        const iframe = document.createElement("iframe");
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "0";
        mount.appendChild(iframe);
        let srcDocContent = "";
        if (language === "html") {
          srcDocContent = `<html><body>${code}</body></html>`;
        } else if (language === "css") {
          srcDocContent = `<html><head><style>${code}</style></head><body></body></html>`;
        } else if (language === "javascript") {
          srcDocContent = `<html><body><script>${code}<\/script></body></html>`;
        }
        const iframeDoc = iframe.contentWindow.document;
        iframeDoc.open();
        iframeDoc.write(srcDocContent);
        iframeDoc.close();
        setOutput("Rendered in preview.");
      } else {
        setOutput("Preview mount missing.");
      }
      return;
    }

    if (taskId) {
      try {
        const res = await api.post("code/execute/", {
          code,
          language,
          task_id: taskId,
        });
        if (res.data.error) {
          setOutput(`Error: ${res.data.error}`);
        } else {
          setOutput(res.data.output || "Executed.");
        }
      } catch {
        setOutput("Failed to execute code. Please check your backend API.");
      }
    }
  };

  // ---------- Repo helpers ----------
  const findFileAndApplyChange = (fileTree, path, content, activePath) =>
    fileTree.map((item) => {
      const fullPath = pathJoin(path, item.name);
      if (fullPath === activePath && !item.children) {
        return { ...item, content };
      }
      if (item.children) {
        return {
          ...item,
          children: findFileAndApplyChange(item.children, fullPath, content, activePath),
        };
      }
      return item;
    });

  const mutateTree = (tree, cb) =>
    JSON.parse(JSON.stringify(cb(JSON.parse(JSON.stringify(tree)))));

  const addFileAtPath = (tree, folderPath, fileName) => {
    const parts = folderPath ? folderPath.split("/") : [];
    if (parts.length === 0) return [...tree, { name: fileName, content: "" }];

    const addRec = (nodes, idx) =>
      nodes.map((n) => {
        if (!n.children) return n;
        if (n.name === parts[idx]) {
          if (idx === parts.length - 1) {
            return { ...n, children: [...n.children, { name: fileName, content: "" }] };
          }
          return { ...n, children: addRec(n.children, idx + 1) };
        }
        return n;
      });

    return addRec(tree, 0);
  };

  const addFolderAtPath = (tree, folderPath, newFolderName) => {
    const parts = folderPath ? folderPath.split("/") : [];
    if (parts.length === 0) return [...tree, { name: newFolderName, children: [] }];

    const addRec = (nodes, idx) =>
      nodes.map((n) => {
        if (!n.children) return n;
        if (n.name === parts[idx]) {
          if (idx === parts.length - 1) {
            return { ...n, children: [...n.children, { name: newFolderName, children: [] }] };
          }
          return { ...n, children: addRec(n.children, idx + 1) };
        }
        return n;
      });

    return addRec(tree, 0);
  };

  const deleteAtPath = (tree, targetPath) => {
    const parts = targetPath.split("/");
    const delRec = (nodes, idx) => {
      if (idx === parts.length - 1) return nodes.filter((n) => n.name !== parts[idx]);
      return nodes.map((n) => {
        if (n.children && n.name === parts[idx]) {
          return { ...n, children: delRec(n.children, idx + 1) };
        }
        return n;
      });
    };
    if (parts.length === 1) return tree.filter((n) => n.name !== parts[0]);
    return delRec(tree, 0);
  };

  const renameAtPath = (tree, targetPath, newName) => {
    const parts = targetPath.split("/");
    const renRec = (nodes, idx) =>
      nodes.map((n) => {
        if (n.name !== parts[idx]) return n;
        if (idx === parts.length - 1) return { ...n, name: newName };
        if (n.children) return { ...n, children: renRec(n.children, idx + 1) };
        return n;
      });
    if (parts.length === 1) return tree.map((n) => (n.name === parts[0] ? { ...n, name: newName } : n));
    return renRec(tree, 0);
  };

  // ---------- Code Save / Submit ----------
  const saveCodeLocally = (taskId, updatedTree, currentCode, language) => {
    const saved = LocalRepo.save(taskId, {
      file_structure: updatedTree || [],
      code_content: currentCode || "",
      language: language || "javascript",
    });
    return saved;
  };

  const handleCodeSubmitForReview = async (task, localTree, localCode, language) => {
    try {
      saveCodeLocally(task.id, localTree, localCode || "", language || "javascript");
      const res = await api.patch(`tasks/${task.id}/`, { status: "REVIEW" });
      upsertTaskInState(res.data);
      setNotifications((prev) => [...prev, `Task "${task.title}" submitted for review! 🎉`]);
      setActiveTaskForCoding(null);
      setActiveTab("tasks");
      Telemetry.log("task_submit_review", { taskId: task.id });
    } catch {
      setError("Failed to submit task for review.");
    }
  };

  // ---------- Code editor entry ----------
  const handleTaskCodeClick = async (task) => {
    const fresh = await getTaskById(task.id);
    const openTask = fresh || task;

    setActiveTab("platform");
    setActivePane("code");
    setActiveTaskForCoding(openTask);

    const local = LocalRepo.load(openTask.id);
    const tree = local?.file_structure || SafeParseJson(openTask.file_structure) || [];
    const code = local?.code_content || openTask.code_content || "// Write your code here...";
    const lang = local?.language || "javascript";

    setFileStructure(tree);
    setCodeContent(code);
    setCodeLanguage(lang);

    const pickFirstFile = (nodes, p = "") => {
      for (const n of nodes) {
        const full = p ? `${p}/${n.name}` : n.name;
        if (!n.children) return full;
        const deep = pickFirstFile(n.children, full);
        if (deep) return deep;
      }
      return null;
    };
    const firstFile = pickFirstFile(tree) || null;
    setActiveFile(firstFile);
    Telemetry.log("code_open", { taskId: openTask.id });
  };

  const handleTaskViewCode = async (task, from = "EMPLOYEE") => {
    const fresh = await getTaskById(task.id);
    const viewTask = fresh || task;
    const merged = mergeLocalIntoTask(viewTask);
    if (from === "EMPLOYEE") {
      setTaskForEmployeeView(merged);
      setShowEmployeeCodeView(true);
    } else {
      setTaskForCodeReview(merged);
      setShowScrumMasterCodeView(true);
    }
    Telemetry.log("view_code", { taskId: task.id, from });
  };

  // ---------- Employees ----------
  const handleAddEmployee = async (e) => {
    e.preventDefault();
    setError(null);
    if (!newEmployee.username || !newEmployee.password) {
      setError("Enter username and password");
      return;
    }
    try {
      await api.post("auth/register/employee/", newEmployee);
      setNewEmployee({ username: "", password: "" });
      setShowAddEmployee(false);
      fetchEmployees();
      setNotifications((prev) => [
        ...prev,
        `Employee "${newEmployee.username}" added successfully! 🧑‍💻`,
      ]);
      Telemetry.log("employee_add", { username: newEmployee.username });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add employee");
    }
  };

  const handleSaveEdit = async () => {
    if (!editEmployee?.username) {
      setError("Username cannot be empty");
      return;
    }
    try {
      await api.put(`employees/${editEmployee.id}/`, { username: editEmployee.username });
      setEditEmployee(null);
      fetchEmployees();
      setNotifications((prev) => [...prev, `Employee updated successfully! ✍️`]);
      Telemetry.log("employee_edit", { employeeId: editEmployee.id });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to edit employee");
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (!window.confirm("Are you sure you want to delete this employee?")) return;
    try {
      await api.delete(`employees/${id}/`);
      fetchEmployees();
      setNotifications((prev) => [...prev, `Employee deleted successfully! 💥`]);
      Telemetry.log("employee_delete", { employeeId: id });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete employee");
    }
  };

  const handleEmployeeClick = (emp) => {
    setSelectedEmployee(emp);
    Telemetry.log("employee_view_tasks", { employeeId: emp.id });
  };
  const handleBackToEmployees = () => setSelectedEmployee(null);

  // ---------- Meetings CRUD (Scrum only), View for Employees ----------
  const handleAddMeetingSubmit = async (e) => {
    e.preventDefault();
    setMeetingError(null);

    const t = (newMeeting.title || "").trim();
    const link = (newMeeting.link || "").trim();
    if (!t) {
      setMeetingError("Meeting title is required");
      return;
    }
    if (!isValidUrl(link)) {
      setMeetingError("Enter a valid meeting URL (e.g., Microsoft Teams / Zoom / Meet)");
      return;
    }
    try {
      const payload = {
        title: t,
        agenda: newMeeting.agenda || "",
        starts_at: newMeeting.starts_at || null,
        ends_at: newMeeting.ends_at || null,
        link,
      };
      const res = await api.post("meetings/", payload);
      setMeetings((prev) => [res.data, ...prev]);
      setNewMeeting(defaultMeeting());
      setShowAddMeeting(false);
      setNotifications((prev) => [...prev, `Meeting "${res.data.title}" scheduled.`]);
      Telemetry.log("meeting_create", { meetingId: res.data.id });
    } catch (err) {
      setMeetingError(err.response?.data?.error || "Failed to schedule meeting");
    }
  };

  const handleUpdateMeeting = async (meeting) => {
    const title = window.prompt("Edit meeting title:", meeting.title);
    if (title === null) return;
    const agenda = window.prompt("Edit agenda:", meeting.agenda ?? "");
    if (agenda === null) return;
    const starts_at = window.prompt("Edit start (YYYY-MM-DDTHH:MM):", meeting.starts_at ?? "");
    if (starts_at === null) return;
    const ends_at = window.prompt("Edit end (YYYY-MM-DDTHH:MM):", meeting.ends_at ?? "");
    if (ends_at === null) return;
    const link = window.prompt("Edit link:", meeting.link ?? "");
    if (link === null) return;
    if (!isValidUrl(link)) {
      setMeetingError("Enter a valid URL");
      return;
    }
    try {
      const res = await api.put(`meetings/${meeting.id}/`, {
        title: (title || "").trim(),
        agenda: agenda || "",
        starts_at: starts_at || null,
        ends_at: ends_at || null,
        link: (link || "").trim(),
      });
      setMeetings((prev) => prev.map((m) => (m.id === meeting.id ? res.data : m)));
      setNotifications((prev) => [...prev, `Meeting "${res.data.title}" updated.`]);
      Telemetry.log("meeting_edit", { meetingId: meeting.id });
    } catch (err) {
      setMeetingError(err.response?.data?.error || "Failed to update meeting");
    }
  };

  const handleDeleteMeeting = async (id) => {
    if (!window.confirm("Delete this meeting?")) return;
    try {
      await api.delete(`meetings/${id}/`);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setNotifications((prev) => [...prev, "Meeting deleted."]);
      Telemetry.log("meeting_delete", { meetingId: id });
    } catch (err) {
      setMeetingError(err.response?.data?.error || "Failed to delete meeting");
    }
  };

  const joinMeeting = (link) => {
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    Telemetry.log("meeting_join", { link });
  };

  // ---------- Search Filters & Telemetry ----------
  const filteredTasks = useMemo(() => {
    const byEmployee = selectedEmployee
      ? tasks.filter((t) => t.assigned_to === selectedEmployee.id)
      : tasks;
    return byEmployee.filter((t) => {
      const text = `${t.title ?? ""} ${t.description ?? ""} ${(t.assigned_to_username || "")}`.toLowerCase();
      return text.includes(searchTerm.toLowerCase());
    });
  }, [tasks, searchTerm, selectedEmployee]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) =>
      (emp.username ?? "").toLowerCase().includes(searchEmployee.toLowerCase())
    );
  }, [employees, searchEmployee]);

  useEffect(() => {
    if (searchTerm) Telemetry.log("search_tasks", { q: searchTerm, count: filteredTasks.length });
  }, [searchTerm, filteredTasks.length]);

  useEffect(() => {
    if (searchEmployee) Telemetry.log("search_employees", { q: searchEmployee, count: filteredEmployees.length });
  }, [searchEmployee, filteredEmployees.length]);

  /* ===========================
     Panels
     =========================== */
  // Badge if code exists (no snippet preview)
  const CodeBadge = ({ taskId }) => {
    const local = LocalRepo.load(taskId);
    const hasRepo = local
      ? (local.file_structure?.length || 0) > 0 || !!local.code_content
      : false;
    if (!hasRepo) return null;
    return <span className="badge"><span className="dot" /> Code available</span>;
  };

  const TaskCardEnhanced = ({ task }) => {
    return (
      <div className="task-card">
        <div className="task-header-row">
          <h3>{task.title}</h3>
          <StatusBadge status={task.status} />
        </div>

        <p>{task.description}</p>
        <p className="assigned-to">Assigned to: {task.assigned_to_username || "Unassigned"}</p>

        <div className="meta-row">
          <CodeBadge taskId={task.id} />
          <DeadlineBadge deadline={task.deadline} />
        </div>

        {task.feedback && (
          <div className="feedback-section">
            <h4>Review Notes:</h4>
            <p>{task.feedback}</p>
          </div>
        )}

        <div className="task-buttons">
          {role === "SCRUM_MASTER" && (
            <>
              <button className="ghost-btn" onClick={() => handleTaskViewCode(task, "SCRUM")}>
                View Code
              </button>
              <button className="edit-btn" onClick={() => handleEditTask(task)}>
                Edit
              </button>
              <button className="delete-btn" onClick={() => handleDeleteTask(task.id)}>
                Delete
              </button>
              {task.status === "REVIEW" && (
                <>
                  <button className="save-code-btn" onClick={() => handleScrumApprove(task)}>
                    ✅ Approve
                  </button>
                  <button className="delete-btn" onClick={() => handleScrumRequestChanges(task)}>
                    📝 Request Changes
                  </button>
                </>
              )}
            </>
          )}

          {role === "EMPLOYEE" && (
            <>
              <button className="ghost-btn" onClick={() => handleTaskViewCode(task, "EMPLOYEE")}>
                View Code
              </button>
              <button className="code-btn" onClick={() => handleTaskCodeClick(task)}>
                Open in Editor
              </button>
              {(task.status === "IN_PROGRESS" ||
                task.status === "FAIL" ||
                task.status === "REVIEW" ||
                task.status === "TODO") && (
                <button
                  className="submit-review-btn"
                  onClick={() =>
                    handleCodeSubmitForReview(
                      task,
                      LocalRepo.load(task.id)?.file_structure || [],
                      LocalRepo.load(task.id)?.code_content || "",
                      LocalRepo.load(task.id)?.language || "javascript"
                    )
                  }
                >
                  Submit for Review
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const DraggableTaskCard = ({ task, index }) => (
    <Draggable draggableId={task.id.toString()} index={index}>
      {(provided) => (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
          <TaskCardEnhanced task={task} />
        </div>
      )}
    </Draggable>
  );

  const renderTaskColumn = (taskList, title, droppableId) => (
    <Droppable droppableId={droppableId}>
      {(provided, snapshot) => (
        <div
          className={`kanban-column ${snapshot.isDraggingOver ? "is-dragging-over" : ""}`}
          ref={provided.innerRef}
          {...provided.droppableProps}
        >
          <h3 className="kanban-column-title">
            {title} ({taskList.length})
          </h3>
          <div className="kanban-column-tasks">
            {taskList.length > 0 ? (
              taskList.map((task, index) => (
                <DraggableTaskCard key={task.id} task={task} index={index} />
              ))
            ) : (
              <p className="no-tasks">No tasks to do.</p>
            )}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );

  const renderStaticTaskColumn = (taskList, title) => (
    <div className="kanban-column">
      <h3 className="kanban-column-title">
        {title} ({taskList.length})
      </h3>
      <div className="kanban-column-tasks">
        {taskList.length > 0 ? (
          taskList.map((task) => <TaskCardEnhanced key={task.id} task={task} />)
        ) : (
          <p className="no-tasks">No tasks.</p>
        )}
      </div>
    </div>
  );

  // KPIs
  const KPICards = ({ kpis }) => {
    const total = (kpis?.completed || 0) + (kpis?.pending || 0);
    const completion = total > 0 ? Math.round((kpis.completed / total) * 100) : 0;
    return (
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-title">Total tasks</div>
          <div className="kpi-value">{total}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Completed</div>
          <div className="kpi-value">{kpis?.completed || 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Pending</div>
          <div className="kpi-value">{kpis?.pending || 0}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-title">Completion</div>
          <div className="kpi-value">{completion}%</div>
        </div>
      </div>
    );
  };

  const DailySummary = () => {
    const dueSoon = tasks.filter(
      (t) =>
        t.deadline &&
        new Date(t.deadline) <= new Date(Date.now() + 86400000) &&
        t.status !== "DONE" &&
        t.status !== "PASS"
    );
    const today = new Date().toISOString().slice(0, 10);
    const assignedToday = tasks.filter((t) => t.created_at?.slice(0, 10) === today).length;
    const completedToday = tasks.filter(
      (t) =>
        (t.status === "DONE" || t.status === "PASS") && t.updated_at?.slice(0, 10) === today
    ).length;

    return (
      <div className="daily-summary">
        <h2>Daily Summary</h2>
        <p>
          🎯 <strong>{tasks.filter((t) => t.status !== "DONE" && t.status !== "PASS").length}</strong> active tasks remaining.
        </p>
        <p>✅ <strong>{completedToday}</strong> tasks completed today.</p>
        <p>🆕 <strong>{assignedToday}</strong> new tasks assigned today.</p>
        {dueSoon.length > 0 && (
          <p className="warning">
            🚨 <strong>{dueSoon.length}</strong> task(s) due soon! Check deadlines.
          </p>
        )}
      </div>
    );
  };

  // Proactive suggestions based on behavioral data
  const ProactiveSuggestions = ({ analyticsData, tasks }) => {
    if (!analyticsData?.kpis) return null;
    const { kpis, throughputLabels, throughputData } = analyticsData;
    const total = tasks.length;
    const completed = kpis.completed;
    const completionRate = total > 0 ? (completed / total) * 100 : 0;
    const overdue = tasks.filter(
      (t) => t.deadline && new Date(t.deadline) < new Date() && !["DONE", "PASS"].includes(t.status)
    );

    const suggestions = [];

    if (completionRate < 50 && total > 10) {
      suggestions.push("Throughput is below 50%. Limit WIP and swarm on blockers.");
    }
    if (overdue.length > 0) {
      suggestions.push(`${overdue.length} overdue item(s). Reprioritize or split into smaller subtasks.`);
    }
    // Focus reminders
    if (kpis.contextSwitchesToday > 15) {
      suggestions.push("High context switching today. Consider a 25-minute focus block to finish one task.");
    }
    // Optimal scheduling windows (top 2 hours)
    const topHours = (kpis.optimalHours || []).slice(0, 2);
    if (topHours.length) {
      const fmt = (h) => `${h.toString().padStart(2, "0")}:00–${((h + 1) % 24).toString().padStart(2, "0")}:00`;
      suggestions.push(
        `You focus best around ${topHours.map((o) => fmt(o.hour)).join(", ")}. Try scheduling deep work then.`
      );
    }
    // Trend nudge
    if (throughputLabels.length >= 3) {
      const last = throughputData[throughputData.length - 1] || 0;
      const prev = throughputData[throughputData.length - 2] || 0;
      if (last < prev) {
        suggestions.push("Throughput dipped vs. yesterday. Clear blockers and validate scope sizing.");
      }
    }

    if (!suggestions.length) return null;

    return (
      <div className="proactive-suggestions">
        <h3>Proactive Suggestions 💡</h3>
        <ul>
          {suggestions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    );
  };

  const AnalyticsPanel = () => {
    if (!analyticsData) return <Loader />;

    const { employeePerformance, burnDownData, kpis, throughputLabels, throughputData, timeByUserMs } =
      analyticsData;

    // Team completion
    const pieData = {
      labels: ["Completed", "Pending"],
      datasets: [
        {
          label: "Task Completion",
          data: [kpis.completed, kpis.pending],
          backgroundColor: ["#48BB78", "#F6AD55"],
          hoverOffset: 8,
        },
      ],
    };

    // By employee bar (completed vs pending)
    const barData = {
      labels: employees.map((e) => e.username),
      datasets: [
        {
          label: "Completed",
          data: employees.map(
            (e) =>
              tasks.filter((t) => t.assigned_to === e.id && (t.status === "DONE" || t.status === "PASS")).length
          ),
          backgroundColor: "#4299E1",
        },
        {
          label: "Pending",
          data: employees.map(
            (e) =>
              tasks.filter((t) => t.assigned_to === e.id && t.status !== "DONE" && t.status !== "PASS").length
          ),
          backgroundColor: "#F6AD55",
        },
      ],
    };

    // Burn-down
    const burnDownChartData = {
      labels: burnDownData.labels,
      datasets: [
        {
          label: "Ideal",
          data: burnDownData.ideal,
          borderColor: "#A0AEC0",
          backgroundColor: "rgba(160, 174, 192, 0.2)",
          tension: 0.1,
          fill: false,
        },
        {
          label: "Actual",
          data: burnDownData.actual,
          borderColor: "#4299E1",
          backgroundColor: "rgba(66, 153, 225, 0.2)",
          tension: 0.1,
          fill: false,
        },
      ],
    };

    // Throughput by day (line/area)
    const throughputChart = {
      labels: throughputLabels,
      datasets: [
        {
          label: "Throughput (tasks done)",
          data: throughputData,
          borderColor: "#7C3AED",
          backgroundColor: "rgba(124, 58, 237, 0.2)",
          tension: 0.3,
          fill: true,
        },
      ],
    };

    // Time on task by user (bar)
    const timeUsers = Object.keys(timeByUserMs);
    const timeHours = timeUsers.map((u) => Math.round((timeByUserMs[u] / 3600000) * 10) / 10);
    const timeByUserChart = {
      labels: timeUsers,
      datasets: [
        {
          label: "Time on task (hrs)",
          data: timeHours,
          backgroundColor: "#10B981",
        },
      ],
    };

    // My analytics
    const me = localStorage.getItem("username");
    const myTasks = tasks.filter((t) => t.assigned_to_username === me);
    const myCompleted = myTasks.filter((t) => t.status === "DONE" || t.status === "PASS").length;
    const myPending = myTasks.length - myCompleted;
    const myTimeMs = (Telemetry.getBuffered() || [])
      .filter((e) => e.type === "time_spent" && e.user === me)
      .reduce((acc, e) => acc + (e.data?.ms || 0), 0);
    const myTimeHrs = Math.round((myTimeMs / 3600000) * 10) / 10;
    const myPie = {
      labels: ["Completed", "Pending"],
      datasets: [{ data: [myCompleted, myPending], backgroundColor: ["#22c55e", "#f59e0b"] }],
    };

    return (
      <div className="analytics-panel">
        <KPICards kpis={kpis} />
        <div className="charts compact-charts">
          <div className="chart-container">
            <h4>Completion</h4>
            <Pie data={pieData} />
          </div>
          <div className="chart-container">
            <h4>By employee</h4>
            <Bar data={barData} />
          </div>
          <div className="chart-container">
            <h4>Burn-down</h4>
            <Line data={burnDownChartData} />
          </div>
        </div>

        <div className="charts">
          <div className="chart-container">
            <h4>Throughput by day</h4>
            <Line data={throughputChart} />
          </div>
          <div className="chart-container">
            <h4>Time on task by user</h4>
            <Bar data={timeByUserChart} />
          </div>
        </div>

        <ProactiveSuggestions analyticsData={analyticsData} tasks={tasks} />

        <h3>My Analytics</h3>
        <div className="charts">
          <div className="chart-container">
            <h4>My completion</h4>
            <Pie data={myPie} />
            <p className="muted">Time on tasks: {myTimeHrs} hrs</p>
          </div>
        </div>
      </div>
    );
  };

  // VS Code-like top bar
  const EditorTopBar = ({
    task,
    language,
    onLanguage,
    onRun,
    onSave,
    onSubmit,
    onAddFileRoot,
    onAddFolderRoot,
    lastSavedAt,
  }) => {
    return (
      <div className="code-header">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>Explorer:</strong>
          <button className="tree-action-btn" onClick={onAddFileRoot} title="Add File">+ File</button>
          <button className="tree-action-btn" onClick={onAddFolderRoot} title="Add Folder">+ Folder</button>
          <span className="muted">•</span>
          <strong>Code:</strong>
          <select
            className="language-select"
            value={language}
            onChange={(e) => onLanguage(e.target.value)}
          >
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
            <option value="css">CSS</option>
            <option value="html">HTML</option>
          </select>
          {lastSavedAt ? <span className="muted">• Saved at {lastSavedAt}</span> : null}
        </div>
        <div className="code-controls">
          <button className="run-code-btn" onClick={onRun}>▶️ Run</button>
          <button className="save-code-btn" onClick={onSave}>💾 Save</button>
          {task && <button className="submit-review-btn" onClick={onSubmit}>🚀 Submit for Review</button>}
        </div>
      </div>
    );
  };

  const CodeTaskPanel = ({ task, onCodeRun, onCancel }) => {
    const initialLocal = useRef(LocalRepo.load(task.id));
    const [currentCode, setCurrentCode] = useState(
      initialLocal.current?.code_content || "// Write your code here..."
    );
    const [output, setOutput] = useState("");
    const [language, setLanguage] = useState(initialLocal.current?.language || "javascript");
    const [localFileStructure, setLocalFileStructure] = useState(
      initialLocal.current?.file_structure || []
    );
    const [currentActiveFile, setCurrentActiveFile] = useState(() => {
      const pickFirst = (nodes, p = "") => {
        for (const n of nodes) {
          const full = p ? `${p}/${n.name}` : n.name;
          if (!n.children) return full;
          const deep = pickFirst(n.children, full);
          if (deep) return deep;
        }
        return null;
      };
      return pickFirst(initialLocal.current?.file_structure || []) || null;
    });
    const [lastSavedAt, setLastSavedAt] = useState(
      initialLocal.current?.saved_at
        ? new Date(initialLocal.current.saved_at).toLocaleTimeString()
        : ""
    );
    const outputMountRef = useRef(null);
    const { stop } = useTimeOnTask(task.id, true);

    const handleLocalCodeChange = (newCode) => {
      const text = newCode ?? "";
      setCurrentCode(text);
      if (currentActiveFile) {
        setLocalFileStructure((prev) => findFileAndApplyChange(prev, "", text, currentActiveFile));
      }
    };

    const handleLocalFileClick = (path, content) => {
      setCurrentActiveFile(path);
      setCurrentCode(content || "");
      Telemetry.log("file_select", { taskId: task.id, path });
    };

    const handleLocalAddFileRoot = () => {
      const fileName = prompt("Enter file name:");
      if (!fileName) return;
      setLocalFileStructure((prev) => [...prev, { name: fileName, content: "" }]);
      setCurrentActiveFile(fileName);
      setCurrentCode("");
      Telemetry.log("repo_add_file", { taskId: task.id, path: fileName });
    };
    const handleLocalAddFolderRoot = () => {
      const folderName = prompt("Enter folder name:");
      if (!folderName) return;
      setLocalFileStructure((prev) => [...prev, { name: folderName, children: [] }]);
      Telemetry.log("repo_add_folder", { taskId: task.id, path: folderName });
    };
    const handleLocalAddFileHere = (folderPath) => {
      const fileName = prompt("Enter file name:");
      if (!fileName) return;
      setLocalFileStructure((prev) => mutateTree(prev, (t) => addFileAtPath(t, folderPath, fileName)));
      Telemetry.log("repo_add_file", { taskId: task.id, path: `${folderPath}/${fileName}` });
    };
    const handleLocalAddFolderHere = (folderPath) => {
      const folderName = prompt("Enter folder name:");
      if (!folderName) return;
      setLocalFileStructure((prev) => mutateTree(prev, (t) => addFolderAtPath(t, folderPath, folderName)));
      Telemetry.log("repo_add_folder", { taskId: task.id, path: `${folderPath}/${folderName}` });
    };
    const handleLocalRename = (path) => {
      const newName = prompt("Enter new name:");
      if (!newName) return;
      setLocalFileStructure((prev) => mutateTree(prev, (t) => renameAtPath(t, path, newName)));
      if (currentActiveFile && currentActiveFile.startsWith(path)) {
        const parts = path.split("/");
        parts[parts.length - 1] = newName;
        setCurrentActiveFile(parts.join("/"));
      }
      Telemetry.log("repo_rename", { taskId: task.id, from: path, to: newName });
    };
    const handleLocalDelete = (path) => {
      if (!window.confirm(`Delete "${path}"?`)) return;
      setLocalFileStructure((prev) => mutateTree(prev, (t) => deleteAtPath(t, path)));
      if (currentActiveFile === path) {
        setCurrentActiveFile(null);
        setCurrentCode("");
      }
      Telemetry.log("repo_delete", { taskId: task.id, path });
    };

    const handleRun = () => onCodeRun(currentCode || "", language, setOutput, task.id, outputMountRef);

    const handleSave = () => {
      const saved = saveCodeLocally(task.id, localFileStructure, currentCode || "", language || "javascript");
      const t = new Date(saved.saved_at).toLocaleTimeString();
      setLastSavedAt(t);
      setNotifications((prev) => [...prev, `Saved at ${t}`]);
      Telemetry.log("code_save", {
        taskId: task.id,
        size: (currentCode || "").length,
        files: Array.isArray(localFileStructure) ? localFileStructure.length : 0,
      });
    };

    const handleSubmit = async () => {
      handleSave();
      try {
        const res = await api.patch(`tasks/${task.id}/`, { status: "REVIEW" });
        upsertTaskInState(res.data);
        setNotifications((prev) => [...prev, `Task "${task.title}" submitted for review! 🎉`]);
        stop("submit");
        onCancel();
        Telemetry.log("task_submit_review", { taskId: task.id });
      } catch {
        setError("Failed to submit task for review.");
      }
    };

    return (
      <div className="tool-content code-editor-container">
        <div className="task-header">
          <div>
            <h3>Coding: {task.title}</h3>
            <p className="muted">Save to persist. No autosave.</p>
          </div>
        </div>

        <EditorTopBar
          task={task}
          language={language}
          onLanguage={setLanguage}
          onRun={handleRun}
          onSave={handleSave}
          onSubmit={handleSubmit}
          onAddFileRoot={handleLocalAddFileRoot}
          onAddFolderRoot={handleLocalAddFolderRoot}
          lastSavedAt={lastSavedAt}
        />

        <div className="code-workspace">
          <div className="file-sidebar">
            {localFileStructure.length === 0 ? (
              <div className="repo-empty">
                <p>No repository initialized.</p>
                <button
                  className="primary-btn"
                  onClick={() => {
                    setLocalFileStructure([{ name: "src", children: [] }]);
                    Telemetry.log("repo_init", { taskId: task.id, root: "src" });
                  }}
                >
                  Initialize Repository (src/)
                </button>
              </div>
            ) : (
              <FileTreeView
                files={localFileStructure}
                activeFile={currentActiveFile}
                onFileClick={handleLocalFileClick}
                onAddFileRoot={handleLocalAddFileRoot}
                onAddFolderRoot={handleLocalAddFolderRoot}
                onAddFileHere={handleLocalAddFileHere}
                onAddFolderHere={handleLocalAddFolderHere}
                onRename={handleLocalRename}
                onDelete={handleLocalDelete}
              />
            )}
          </div>

          <div className="editor-and-actions">
            <div className="editor-and-output">
              <div className="editor-container">
                <Editor
                  height="420px"
                  language={language}
                  value={currentCode}
                  onChange={handleLocalCodeChange}
                  theme="vs-dark"
                  options={{ fontSize: 14, minimap: { enabled: false }, readOnly: false }}
                  onMount={() => Telemetry.log("editor_mount", { taskId: task.id })}
                />
              </div>
              <div className="output-container">
                <h4>Output</h4>
                <div
                  ref={outputMountRef}
                  style={{
                    width: "100%",
                    height: 180,
                    border: "1px dashed #e2e8f0",
                    borderRadius: 8,
                    background: "#fff",
                    marginBottom: 8,
                  }}
                />
                <pre>{output}</pre>
              </div>
            </div>
          </div>
        </div>

        <div className="code-footer">
          <button
            onClick={() => {
              stop("back");
              onCancel();
            }}
            className="back-btn"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  };

  const PowerBIEmbed = ({ url }) => {
    if (!url) return null;
    return (
      <div className="chart-container">
        <h4>Power BI</h4>
        <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
          <iframe
            title="Power BI"
            src={url}
            frameBorder="0"
            allowFullScreen
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          />
        </div>
      </div>
    );
  };

  const PlatformPanel = () => {
    if (activeTaskForCoding) {
      return (
        <CodeTaskPanel
          task={activeTaskForCoding}
          onCodeRun={handleCodeRun}
          onCancel={() => {
            setActiveTaskForCoding(null);
            setFileStructure([]);
            setActiveFile(null);
          }}
        />
      );
    }
    return (
      <div className="tools-panel">
        <div className="tools-nav">
          <button
            className={`tool-tab ${activePane === "code" ? "active" : ""}`}
            onClick={() => {
              setActivePane("code");
              Telemetry.log("nav_switch", { to: "platform_code" });
            }}
          >
            Code
          </button>
          <button
            className={`tool-tab ${activePane === "data-analytics" ? "active" : ""}`}
            onClick={() => {
              setActivePane("data-analytics");
              Telemetry.log("nav_switch", { to: "platform_data" });
            }}
          >
            Data Analytics
          </button>
        </div>

        {activePane === "code" && (
          <div className="tool-content code-editor-container">
            <h3>Scratchpad</h3>
            <div className="code-header">
              <select
                className="language-select"
                value={codeLanguage}
                onChange={(e) => setCodeLanguage(e.target.value)}
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="css">CSS</option>
                <option value="html">HTML</option>
              </select>
              <div className="code-controls">
                <button
                  className="run-code-btn"
                  onClick={() => {
                    const scratchMount = { current: document.getElementById("scratch-output-mount") };
                    handleCodeRun(codeContent || "", codeLanguage, setCodeOutput, null, scratchMount);
                  }}
                >
                  ▶️ Run
                </button>
                <button
                  className="save-code-btn"
                  onClick={() => {
                    const saved = LocalRepo.save(-1, {
                      file_structure: [],
                      code_content: codeContent || "",
                      language: codeLanguage || "javascript",
                    });
                    const t = new Date(saved.saved_at).toLocaleTimeString();
                    setNotifications((prev) => [...prev, `Saved at ${t}`]);
                    Telemetry.log("code_save", { taskId: null, size: (codeContent || "").length, files: 0 });
                  }}
                >
                  💾 Save
                </button>
              </div>
            </div>
            <div className="editor-and-output">
              <div className="editor-container">
                <Editor
                  height="300px"
                  language={codeLanguage}
                  value={codeContent}
                  onChange={(value) => setCodeContent(value ?? "")}
                  theme="vs-dark"
                  options={{ readOnly: false, minimap: { enabled: false } }}
                />
              </div>
              <div className="output-container">
                <h4>Output</h4>
                <div
                  id="scratch-output-mount"
                  style={{
                    width: "100%",
                    height: 160,
                    border: "1px dashed #e2e8f0",
                    borderRadius: 8,
                    background: "#fff",
                    marginBottom: 8,
                  }}
                />
                <pre>{codeOutput}</pre>
              </div>
            </div>
          </div>
        )}

        {activePane === "data-analytics" && (
          <div className="tool-content data-analytics-container">
            <h3>Data Analytics</h3>
            <div className="data-upload-section">
              <div className="toolbar">
                <button
                  className="primary-btn"
                  onClick={() => document.getElementById("file-input-data").click()}
                >
                  + Upload CSV/XLSX
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setExcelData([]);
                    setQuery("");
                    setQueryOutput([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <input
                id="file-input-data"
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      try {
                        const data = new Uint8Array(event.target.result);
                        const workbook = XLSX.read(data, { type: "array" });
                        const sheetName = workbook.SheetNames[0];
                        const sheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: "" });
                        setExcelData(jsonData);
                        setQueryOutput(jsonData);
                        setQuery("");
                        Telemetry.log("data_upload", { rows: jsonData.length, file: file.name });
                      } catch {
                        setError("Failed to parse file.");
                      }
                    };
                    reader.readAsArrayBuffer(file);
                  }
                }}
                accept=".csv, .xlsx"
              />
            </div>

            {excelData.length > 0 && (
              <>
                <div className="data-query-section">
                  <h4>Run a Query</h4>
                  <p>Example: SELECT * FROM data WHERE name='John'</p>
                  <div className="query-input-row">
                    <input
                      type="text"
                      className="query-input"
                      placeholder="Enter your query..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                      className="run-query-btn"
                      onClick={() => {
                        const lower = (query || "").toLowerCase().trim();
                        Telemetry.log("data_query_run", { q: query });
                        if (!lower.startsWith("select")) {
                          setQueryOutput([]);
                          setError("Invalid query. Only SELECT statements are supported.");
                          return;
                        }
                        try {
                          const filtered = excelData.filter((row) => {
                            if (lower.includes("where")) {
                              const condition = lower.split("where")[1].trim();
                              const [key, value] = condition
                                .split("=")
                                .map((s) => s.trim().replace(/['"]/g, ""));
                              return String(row[key]) === value;
                            }
                            return true;
                          });
                          setQueryOutput(filtered);
                          setError(null);
                        } catch {
                          setError("Failed to run query. Please check syntax.");
                          setQueryOutput([]);
                        }
                      }}
                    >
                      Run Query
                    </button>
                  </div>
                  {error && <p style={{ color: "red" }}>{error}</p>}
                  <div className="query-results">
                    <h4>Query Results</h4>
                    {queryOutput.length > 0 ? (
                      <table>
                        <thead>
                          <tr>
                            {Object.keys(queryOutput[0]).map((key) => (
                              <th key={key}>{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryOutput.map((row, index) => (
                            <tr key={index}>
                              {Object.values(row).map((value, idx) => (
                                <td key={idx}>{value}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p>No results found or invalid query.</p>
                    )}
                  </div>
                </div>

                <div className="analytics-panel">
                  <div className="chart-container">
                    <h4>Bar</h4>
                    <Bar
                      data={{
                        labels: queryOutput.slice(0, 10).map((_, i) => `Row ${i + 1}`),
                        datasets: [
                          {
                            label: "Count",
                            data: queryOutput.slice(0, 10).map((_, i) => i + 1),
                            backgroundColor: "#4299E1",
                          },
                        ],
                      }}
                    />
                  </div>
                  <div className="chart-container">
                    <h4>Line</h4>
                    <Line
                      data={{
                        labels: queryOutput.slice(0, 10).map((_, i) => `Row ${i + 1}`),
                        datasets: [
                          {
                            label: "Trend",
                            data: queryOutput.slice(0, 10).map((_, i) => Math.random() * 10 + i),
                            borderColor: "#48BB78",
                            backgroundColor: "rgba(72, 187, 120, 0.2)",
                            tension: 0.4,
                            fill: true,
                          },
                        ],
                      }}
                    />
                  </div>
                  <div className="chart-container">
                    <h4>Pie</h4>
                    <Pie
                      data={{
                        labels: ["A", "B", "C"],
                        datasets: [
                          {
                            label: "Sample",
                            data: [5, 3, 2],
                            backgroundColor: ["#48BB78", "#F6AD55", "#4299E1"],
                          },
                        ],
                      }}
                    />
                  </div>
                </div>

                <PowerBIEmbed url={"" /* optional */} />
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const CalendarView = () => {
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
    const startDay = monthStart.getDay();
    const daysInMonth = monthEnd.getDate();

    const prevMonth = () =>
      setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
    const nextMonth = () =>
      setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));

    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d));
    }

    const tasksByDate = (date) => {
      const key = date.toISOString().slice(0, 10);
      return tasks.filter((t) => (t.deadline || "").slice(0, 10) === key);
    };

    const monthLabel = calendarMonth.toLocaleString("default", { month: "long", year: "numeric" });

    return (
      <div className="calendar-view">
        <div className="calendar-header">
          <button className="ghost-btn" onClick={prevMonth}>←</button>
          <h3>{monthLabel}</h3>
          <button className="ghost-btn" onClick={nextMonth}>→</button>
        </div>
        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="calendar-cell header">
              {d}
            </div>
          ))}
          {cells.map((date, idx) => (
            <div key={idx} className={`calendar-cell ${date ? "" : "empty"}`}>
              {date && (
                <>
                  <div className="date-label">{date.getDate()}</div>
                  <div className="calendar-tasks">
                    {tasksByDate(date).map((t) => (
                      <div key={t.id} className={`calendar-task ${t.status.toLowerCase()}`} title={`${t.title} (${t.status})`}>
                        {t.title}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Meetings
  const MeetingsPanel = () => {
    const canEdit = role === "SCRUM_MASTER";

    return (
      <div className="meetings-panel">
        <div className="toolbar">
          <h2>Meetings</h2>
          {canEdit && (
            <>
              <button className="add-task-btn" onClick={() => setShowAddMeeting((s) => !s)}>+ Schedule Meeting</button>
              <button className="ghost-btn" onClick={fetchMeetings} title="Reload meetings">↻ Refresh</button>
            </>
          )}
        </div>

        {showAddMeeting && canEdit && (
          <form className="task-form" onSubmit={handleAddMeetingSubmit}>
            <input
              type="text"
              placeholder="Meeting title (required)"
              value={newMeeting.title}
              onChange={(e) => setNewMeeting({ ...newMeeting, title: e.target.value })}
              required
            />
            <input
              type="url"
              placeholder="Meeting link (required)"
              value={newMeeting.link}
              onChange={(e) => setNewMeeting({ ...newMeeting, link: e.target.value })}
              required
            />
            <textarea
              placeholder="Agenda (optional)"
              value={newMeeting.agenda}
              onChange={(e) => setNewMeeting({ ...newMeeting, agenda: e.target.value })}
            />
            <div className="grid-2">
              <input
                type="datetime-local"
                value={newMeeting.starts_at}
                onChange={(e) => setNewMeeting({ ...newMeeting, starts_at: e.target.value })}
              />
              <input
                type="datetime-local"
                value={newMeeting.ends_at}
                onChange={(e) => setNewMeeting({ ...newMeeting, ends_at: e.target.value })}
              />
            </div>

            <div className="form-buttons">
              <button type="submit" className="big-btn create-btn">Create</button>
              <button type="button" className="big-btn cancel-btn" onClick={() => setShowAddMeeting(false)}>Cancel</button>
            </div>
            {meetingError && <p style={{ color: "red" }}>{meetingError}</p>}
          </form>
        )}

        {loadingMeetings ? (
          <Loader />
        ) : (
          <div className="tasks-grid">
            {meetings.length > 0 ? (
              meetings.map((m) => {
                const when = m.starts_at
                  ? new Date(m.starts_at).toLocaleString()
                  : "No time set";
                const ends = m.ends_at ? new Date(m.ends_at).toLocaleString() : null;
                return (
                  <div key={m.id} className="employee-card">
                    <h3>{m.title}</h3>
                    <p className="muted">{m.agenda || "No agenda"}</p>
                    <p><strong>Starts:</strong> {when}</p>
                    {ends && <p><strong>Ends:</strong> {ends}</p>}
                    <div className="task-buttons">
                      <button className="view-btn" onClick={() => joinMeeting(m.link)}>Join</button>
                      {canEdit && (
                        <>
                          <button className="edit-btn" onClick={() => handleUpdateMeeting(m)}>Edit</button>
                          <button className="delete-btn" onClick={() => handleDeleteMeeting(m.id)}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p>No meetings scheduled.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Project Status
  const ProjectStatusPanel = () => {
    const inReview = filteredTasks.filter((task) => task.status === "REVIEW");
    const passed = filteredTasks.filter((task) => task.status === "PASS");
    const failed = filteredTasks.filter((task) => task.status === "FAIL");

    const Column = ({ title, items }) => (
      <div className="kanban-column">
        <h3 className="kanban-column-title">
          {title} ({items.length})
        </h3>
        <div className="kanban-column-tasks">
          {items.length > 0 ? (
            items.map((task) => <TaskCardEnhanced key={task.id} task={task} />)
          ) : (
            <p className="no-tasks">No tasks.</p>
          )}
        </div>
      </div>
    );

    return (
      <div className="project-status-panel">
        <div className="filters-row">
          <input
            className="search-input"
            placeholder="Search tasks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="kanban-board-container single-column">
          <Column title="In Review" items={inReview} />
          <Column title="Passed" items={passed} />
          <Column title="Failed" items={failed} />
        </div>
      </div>
    );
  };

  // About
  const AboutPanel = () => (
    <div className="about-card card">
      <h2>About Scrum.io</h2>
      <p>
        Scrum.io is a production-grade Code & Data Analytics Platform with integrated task management,
        Kanban boards, calendar scheduling, behavioral telemetry, analytics dashboards, and a VS Code–style
        coding environment. It streamlines developer workflows by connecting tasks, code, and insights in one place.
      </p>
      <ul>
        <li><strong>Tasks & Workflow:</strong> Create tasks, drag-and-drop, submit for review, approve or request changes.</li>
        <li><strong>Code Platform:</strong> Monaco editor, manual save, file explorer (+File/+Folder), in-browser preview.</li>
        <li><strong>Data Analytics:</strong> Upload CSV/XLSX, simple SQL-like queries, charts, optional Power BI embed.</li>
        <li><strong>Behavioral Telemetry:</strong> Time on task, navigation, editor actions feeding analytics.</li>
        <li><strong>Meetings:</strong> Scrum Masters schedule; Employees join with one click.</li>
        <li><strong>Security & Roles:</strong> Role-aware actions for clarity and accountability.</li>
      </ul>
      <p className="muted">Built for reliability, clarity, and speed—so teams can focus on shipping quality software.</p>
    </div>
  );

  // Contact
  const ContactPanel = () => (
    <div className="about-card card">
      <h2>Contact</h2>
      <p>Have feedback or need support?</p>
      <ul>
        <li><strong>Support:</strong> support@scrumio.example</li>
        <li><strong>Docs:</strong> Coming soon</li>
        <li><strong>Feedback:</strong> Use the Assistant tab to share quick thoughts.</li>
      </ul>
    </div>
  );

  const AssistantPanel = () => (
    <div className="assistant-panel">
      <Chatbot role={role} tasks={tasks} meetings={meetings} pageMode />
    </div>
  );

  const renderDashboardContent = () => {
    switch (activeTab) {
      case "tasks": {
        const todo = filteredTasks.filter((t) => t.status === "TODO");
        const inProgress = filteredTasks.filter((t) => t.status === "IN_PROGRESS");
        const inReview = filteredTasks.filter((t) => t.status === "REVIEW");
        const done = filteredTasks.filter((t) => t.status === "DONE" || t.status === "PASS");

        return (
          <>
            <div className="toolbar">
              {role === "SCRUM_MASTER" && (
                <>
                  <button className="add-task-btn" onClick={() => setShowAddTask((s) => !s)}>
                    + Add Task
                  </button>
                  <button className="ghost-btn" onClick={fetchTasks} title="Reload tasks">↻ Refresh</button>
                </>
              )}
              {role === "EMPLOYEE" && (
                <>
                  <button className="ghost-btn" onClick={() => setActiveTab("platform")}>
                    🔧 Open Code & Data Analytics
                  </button>
                  <button className="ghost-btn" onClick={fetchTasks} title="Reload tasks">↻ Refresh</button>
                </>
              )}
            </div>

            {showAddTask && role === "SCRUM_MASTER" && (
              <form className="task-form" onSubmit={handleAddTaskSubmit}>
                <input
                  type="text"
                  placeholder="Title"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  required
                />
                <textarea
                  placeholder="Description"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                />
                <input
                  type="date"
                  value={newTask.deadline}
                  onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                />
                <select
                  value={newTask.status}
                  onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                >
                  <option value="TODO">To Do</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="REVIEW">In Review</option>
                  <option value="DONE">Done</option>
                </select>
                {loadingEmployees ? (
                  <Loader />
                ) : (
                  <select
                    value={newTask.assigned_to}
                    onChange={(e) => setNewTask({ ...newTask, assigned_to: e.target.value })}
                    required
                  >
                    <option value="">-- Assign to employee --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.username}
                      </option>
                    ))}
                  </select>
                )}
                <div className="form-buttons">
                  <button type="submit" className="big-btn create-btn">
                    Create Task
                  </button>
                  <button type="button" className="big-btn cancel-btn" onClick={() => setShowAddTask(false)}>
                    Cancel
                  </button>
                </div>
                {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
              </form>
            )}

            <div className="filters-row">
              <input
                className="search-input"
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {loadingTasks ? (
              <Loader />
            ) : (
              <div className="kanban-board-container single-column">
                <DragDropContext onDragEnd={handleDragEnd}>
                  {renderTaskColumn(todo, "To Do", "TODO")}
                  {renderTaskColumn(inProgress, "In Progress", "IN_PROGRESS")}
                  {renderTaskColumn(inReview, "In Review", "REVIEW")}
                  {renderTaskColumn(done, "Done", "DONE")}
                </DragDropContext>
              </div>
            )}
          </>
        );
      }
      case "employees":
        return (
          <div>
            {role === "SCRUM_MASTER" && (
              <div className="toolbar">
                <button className="add-task-btn" onClick={() => setShowAddEmployee(true)}>+ Add Employee</button>
                <button className="ghost-btn" onClick={fetchEmployees} title="Reload employees">↻ Refresh</button>
              </div>
            )}
            {selectedEmployee ? (
              <div className="employee-tasks-view">
                <button className="back-btn" onClick={handleBackToEmployees}>← Back to Employees</button>
                <h2>Tasks for {selectedEmployee.username}</h2>
                <div className="filters-row">
                  <input
                    className="search-input"
                    placeholder="Search tasks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="kanban-board-container single-column">
                  {renderStaticTaskColumn(
                    filteredTasks.filter((task) => task.status === "TODO"),
                    "To Do"
                  )}
                  {renderStaticTaskColumn(
                    filteredTasks.filter((task) => task.status === "IN_PROGRESS"),
                    "In Progress"
                  )}
                  {renderStaticTaskColumn(
                    filteredTasks.filter((task) => task.status === "REVIEW"),
                    "In Review"
                  )}
                  {renderStaticTaskColumn(
                    filteredTasks.filter((task) => task.status === "DONE" || task.status === "PASS"),
                    "Done"
                  )}
                </div>
              </div>
            ) : (
              <>
                {showAddEmployee && role === "SCRUM_MASTER" && (
                  <form className="task-form" onSubmit={handleAddEmployee}>
                    <input
                      type="text"
                      placeholder="Username"
                      value={newEmployee.username}
                      onChange={(e) => setNewEmployee({ ...newEmployee, username: e.target.value })}
                      required
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={newEmployee.password}
                      onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })}
                      required
                    />
                    <div className="form-buttons">
                      <button type="submit" className="big-btn create-btn">Add</button>
                      <button type="button" className="big-btn cancel-btn" onClick={() => setShowAddEmployee(false)}>Cancel</button>
                    </div>
                    {error && <p style={{ color: "red" }}>{error}</p>}
                  </form>
                )}
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search employees..."
                  value={searchEmployee}
                  onChange={(e) => setSearchEmployee(e.target.value)}
                />
                <div className="tasks-grid">
                  {loadingEmployees ? (
                    <Loader />
                  ) : filteredEmployees.length > 0 ? (
                    filteredEmployees.map((emp) => (
                      <EmployeeCard
                        key={emp.id}
                        emp={emp}
                        editEmployee={editEmployee}
                        setEditEmployee={setEditEmployee}
                        handleSaveEdit={handleSaveEdit}
                        handleDeleteEmployee={handleDeleteEmployee}
                        tasks={tasks}
                        onEmployeeClick={handleEmployeeClick}
                      />
                    ))
                  ) : (
                    <p>No employees found.</p>
                  )}
                </div>
              </>
            )}
          </div>
        );
      case "project-status":
        return <ProjectStatusPanel />;
      case "analytics":
        return (
          <>
            <DailySummary />
            <AnalyticsPanel />
          </>
        );
      case "calendar":
        return <CalendarView />;
      case "meetings":
        return <MeetingsPanel />;
      case "about":
        return <AboutPanel />;
      case "contact":
        return <ContactPanel />;
      case "platform":
        return role === "EMPLOYEE" ? <PlatformPanel /> : (
          <div className="proactive-suggestions">
            <h3>Code & Data Analytics Platform</h3>
            <p className="muted">This section is intended for employees to write and run code and explore data.</p>
          </div>
        );
      case "assistant":
        return role === "EMPLOYEE" ? <AssistantPanel /> : null;
      default:
        return null;
    }
  };

  // Title without hooks (prevents hook order issues)
  const getTitleForTab = (tab) => {
    if (tab === "platform") return "Code & Data Analytics Platform";
    if (tab === "meetings") return "Meetings";
    if (tab === "about") return "About";
    if (tab === "contact") return "Contact";
    if (tab === "assistant") return "Assistant";
    return `${tab.charAt(0).toUpperCase() + tab.slice(1)} Dashboard`;
  };
  const titleForTab = getTitleForTab(activeTab);

  // ---------- Entry views (no hooks after this) ----------
  if (!role && !showLogin && !showRegister) {
    return (
      <div className="welcome-container">
        <h1>Welcome to Scrum.io!</h1>
        <p className="subtitle">Select Your Role</p>
        <div className="welcome-buttons">
          <button
            className="welcome-btn scrum-master-btn"
            onClick={() => {
              setLoginRole("SCRUM_MASTER");
              setShowLogin(true);
            }}
          >
            Scrum Master
          </button>
          <button
            className="welcome-btn employee-btn"
            onClick={() => {
              setLoginRole("EMPLOYEE");
              setShowLogin(true);
            }}
          >
            Employee
          </button>
        </div>
      </div>
    );
  }

  if (showRegister) {
    return (
      <div className="login-container">
        <h1>Employee Register</h1>
        <form className="login-form" onSubmit={handleRegisterSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={registerData.username}
            onChange={(e) => setRegisterData({ ...registerData, username: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={registerData.password}
            onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
            required
          />
          <div className="form-buttons">
            <button type="submit" className="big-btn">Register</button>
            <button
              type="button"
              className="big-btn cancel-btn"
              onClick={() => {
                setShowRegister(false);
                setShowLogin(true);
              }}
            >
              Cancel
            </button>
          </div>
          {loginRole === "EMPLOYEE" && (
            <p className="register-link">
              Not registered?{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setShowRegister(true);
                  setShowLogin(false);
                }}
              >
                Register here
              </button>
            </p>
          )}
          {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
        </form>
      </div>
    );
  }

  if (showLogin) {
    return (
      <div className="login-container">
        <h1>{loginRole === "SCRUM_MASTER" ? "Scrum Master Login" : "Employee Login"}</h1>
        <form className="login-form" onSubmit={handleLoginSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={credentials.username}
            onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={credentials.password}
            onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
            required
          />
          <div className="form-buttons">
            <button type="submit" className="big-btn">Login</button>
            <button
              type="button"
              className="big-btn cancel-btn"
              onClick={() => {
                setShowLogin(false);
                setLoginRole(null);
              }}
            >
              Cancel
            </button>
          </div>
          {loginRole === "EMPLOYEE" && (
            <p className="register-link">
              Not registered?{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setShowRegister(true);
                  setShowLogin(false);
                }}
              >
                Register here
              </button>
            </p>
          )}
          {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-container dashboard">
      <div className="sidebar">
        <h1 className="logo">Scrum.io</h1>
        <nav className="main-nav">
          <button
            className={`nav-link ${activeTab === "tasks" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("tasks");
              Telemetry.log("nav_switch", { to: "tasks" });
            }}
          >
            <span className="icon">📋</span> Tasks
          </button>

          {role === "SCRUM_MASTER" && (
            <button
              className={`nav-link ${activeTab === "employees" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("employees");
                setSelectedEmployee(null);
                Telemetry.log("nav_switch", { to: "employees" });
              }}
            >
              <span className="icon">🧑‍💼</span> Employees
            </button>
          )}

          <button
            className={`nav-link ${activeTab === "project-status" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("project-status");
              Telemetry.log("nav_switch", { to: "project-status" });
            }}
          >
            <span className="icon">🧭</span> Project Status
          </button>

          <button
            className={`nav-link ${activeTab === "analytics" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("analytics");
              Telemetry.log("nav_switch", { to: "analytics" });
            }}
          >
            <span className="icon">📈</span> Analytics
          </button>

          <button
            className={`nav-link ${activeTab === "calendar" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("calendar");
              Telemetry.log("nav_switch", { to: "calendar" });
            }}
          >
            <span className="icon">🗓️</span> Calendar
          </button>

          <button
            className={`nav-link ${activeTab === "meetings" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("meetings");
              Telemetry.log("nav_switch", { to: "meetings" });
            }}
          >
            <span className="icon">📞</span> Meetings
          </button>

          <button
            className={`nav-link ${activeTab === "about" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("about");
              Telemetry.log("nav_switch", { to: "about" });
            }}
          >
            <span className="icon">ℹ️</span> About
          </button>

          <button
            className={`nav-link ${activeTab === "contact" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("contact");
              Telemetry.log("nav_switch", { to: "contact" });
            }}
          >
            <span className="icon">✉️</span> Contact
          </button>

          {role === "EMPLOYEE" && (
            <>
              <button
                className={`nav-link ${activeTab === "assistant" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("assistant");
                  Telemetry.log("nav_switch", { to: "assistant" });
                }}
              >
                <span className="icon">💬</span> Assistant
              </button>
              <button
                className={`nav-link ${activeTab === "platform" ? "active" : ""}`}
                onClick={() => {
                  setActiveTab("platform");
                  Telemetry.log("nav_switch", { to: "platform" });
                }}
              >
                <span className="icon">🧰</span> Code & Data Analytics
              </button>
            </>
          )}
        </nav>
        <div className="user-info">
          <p className="user-role">{role}</p>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </div>
      <div className="main-content">
        <header className="dashboard-header">
          <h1 className="dashboard-title">{titleForTab}</h1>
          <div className="toolbar">
            <button
              className="ghost-btn"
              title="Scroll to top"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              ⬆ Scroll to top
            </button>
            {Telemetry.isEnabled() && (
              <button
                className="ghost-btn"
                title="Force-flush buffered telemetry to the backend"
                onClick={() => Telemetry.flush()}
              >
                ⤴ Flush telemetry
              </button>
            )}
          </div>
        </header>

        {notifications.length > 0 && (
          <div className="notifications">
            {notifications.map((note, idx) => (
              <p key={idx} className="notification">
                {note}
              </p>
            ))}
          </div>
        )}

        {showScrumMasterCodeView && taskForCodeReview && (
          <CodeViewerModal
            task={taskForCodeReview}
            onClose={() => setShowScrumMasterCodeView(false)}
          />
        )}

        {showEmployeeCodeView && taskForEmployeeView && (
          <CodeViewerModal
            task={taskForEmployeeView}
            onClose={() => setShowEmployeeCodeView(false)}
          />
        )}

        {renderDashboardContent()}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
