import { useEffect, useState } from 'react';
import axios from '../api/axios';

export default function Meetings() {
  const [meetings, setMeetings] = useState([]);

  useEffect(() => {
    axios.get('/meetings/').then(res => setMeetings(res.data));
  }, []);

  return (
    <div>
      <h2>Meetings</h2>
      <ul>
        {meetings.map(m => (
          <li key={m.id}>{m.title} - {m.date}</li>
        ))}
      </ul>
    </div>
  );
}
