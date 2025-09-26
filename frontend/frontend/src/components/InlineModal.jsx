// components/InlineModal.jsx
import React from "react";

export default function InlineModal({ title, value, onChange, onSubmit, onCancel }) {
  return (
    <div className="inline-modal">
      <h4>{title}</h4>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write your feedback or changes..."
        className="modal-textarea"
      />
      <div className="modal-actions">
        <button onClick={onCancel} className="cancel-btn">Cancel</button>
        <button onClick={onSubmit} className="submit-btn">Submit</button>
      </div>
    </div>
  );
}
