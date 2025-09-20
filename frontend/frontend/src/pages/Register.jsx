import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function EmployeeRegister() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!username || !password) {
      setError("Username and password are required.");
      return;
    }

    try {
      // POST to the updated backend endpoint
      const response = await axios.post(
        "http://127.0.0.1:8000/api/auth/register/employee/",
        { username, password }
      );

      // Extract JWT tokens from response
      const { access, refresh, username: registeredUsername } = response.data;

      if (access && refresh) {
        // Store tokens in localStorage for automatic login
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);

        // Clear the form
        setUsername("");
        setPassword("");

        alert(`Welcome ${registeredUsername}, you are now logged in!`);

        // Redirect to dashboard automatically
        navigate("/dashboard");
      } else {
        setError("Registration succeeded but no token returned.");
      }
    } catch (err) {
      console.error("Register error:", err);
      setError(
        err.response?.data?.error || "Registration failed. Try another username."
      );
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <form
        onSubmit={handleRegister}
        className="bg-white shadow-md rounded-lg p-8 w-96"
      >
        <h2 className="text-2xl font-bold text-center mb-6">
          Employee Register
        </h2>

        {error && <p className="text-red-500 mb-4">{error}</p>}

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-6"
          required
        />

        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
        >
          Register & Login
        </button>
      </form>
    </div>
  );
}

export default EmployeeRegister;
