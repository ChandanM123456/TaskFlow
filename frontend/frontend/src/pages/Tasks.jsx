import { useEffect, useState } from "react";
import API from "../api/axios";

const Tasks = () => {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    API.get("/tasks/").then((res) => setTasks(res.data));
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">My Tasks</h2>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="p-3 border rounded flex justify-between bg-white shadow"
          >
            <div>
              <h3 className="font-semibold">{task.title}</h3>
              <p className="text-sm text-gray-600">{task.description}</p>
            </div>
            <span className="px-3 py-1 rounded bg-blue-100 text-blue-600">
              {task.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Tasks;
