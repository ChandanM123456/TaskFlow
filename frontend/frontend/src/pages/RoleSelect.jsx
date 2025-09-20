import { useNavigate } from "react-router-dom";

const RoleSelect = () => {
  const navigate = useNavigate();

  const handleSelect = (role) => {
    navigate(`/login?role=${role}`);
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-3xl font-bold mb-6">Select Your Role</h1>
      <div className="flex gap-8">
        <button
          onClick={() => handleSelect("SCRUM_MASTER")}
          className="bg-blue-600 text-white px-12 py-6 text-xl rounded-2xl shadow-lg hover:bg-blue-700"
        >
          👨‍💼 Scrum Master
        </button>
        <button
          onClick={() => handleSelect("EMPLOYEE")}
          className="bg-green-600 text-white px-12 py-6 text-xl rounded-2xl shadow-lg hover:bg-green-700"
        >
          👩‍💻 Employee
        </button>
      </div>
    </div>
  );
};

export default RoleSelect;
