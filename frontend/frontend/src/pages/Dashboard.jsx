import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTasks = async () => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        navigate("/login"); // redirect if not logged in
        return;
      }

      try {
        const response = await axios.get("http://127.0.0.1:8000/tasks/", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        setTasks(response.data);
      } catch (err) {
        console.error("Dashboard fetch error:", err);
        navigate("/login"); // redirect if token invalid
      }
    };

    fetchTasks();
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    navigate("/login");
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <button
        onClick={handleLogout}
        className="mb-6 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
      >
        Logout
      </button>

      <ul>
        {tasks.map((task) => (
          <li key={task.id} className="mb-2">
            {task.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Dashboard;
