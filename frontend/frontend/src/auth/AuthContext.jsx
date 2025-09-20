import { createContext, useState } from "react";
import jwtDecode from "jwt-decode";
import axios from "axios";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(
    localStorage.getItem("access")
      ? jwtDecode(localStorage.getItem("access"))
      : null
  );

  const login = async (username, password) => {
    const res = await axios.post("http://127.0.0.1:8000/api/auth/login/", {
      username,
      password,
    });

    localStorage.setItem("access", res.data.access);
    localStorage.setItem("refresh", res.data.refresh);

    const decoded = jwtDecode(res.data.access);
    setUser(decoded);
  };

  const logout = () => {
    localStorage.removeItem("access");
    localStorage.removeItem("refresh");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
