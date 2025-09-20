import './style.css'
import javascriptLogo from './javascript.svg'
import viteLogo from '/vite.svg'
import { setupCounter } from './counter.js'
import axios from 'axios'  // Make sure axios is installed: npm install axios

const app = document.querySelector('#app')

// Initial HTML structure
app.innerHTML = `
  <div>
    <a href="https://vite.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank">
      <img src="${javascriptLogo}" class="logo vanilla" alt="JavaScript logo" />
    </a>
    <h1>Tasks from Django Backend</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <div id="tasks-container">
      <p>Loading tasks...</p>
    </div>
    <p class="read-the-docs">
      Click on the Vite logo to learn more
    </p>
  </div>
`

setupCounter(document.querySelector('#counter'))

// Fetch tasks from Django backend
const tasksContainer = document.getElementById('tasks-container')

axios.get('http://127.0.0.1:8000/api/tasks/')  // Replace with your actual API endpoint
  .then(response => {
    const tasks = response.data
    if (tasks.length === 0) {
      tasksContainer.innerHTML = "<p>No tasks found.</p>"
    } else {
      const ul = document.createElement('ul')
      tasks.forEach(task => {
        const li = document.createElement('li')
        li.textContent = task.title  // Replace 'title' with your actual field
        ul.appendChild(li)
      })
      tasksContainer.innerHTML = ""  // Clear "Loading tasks..." text
      tasksContainer.appendChild(ul)
    }
  })
  .catch(error => {
    console.error("Error fetching tasks:", error)
    tasksContainer.innerHTML = "<p style='color:red;'>Failed to load tasks.</p>"
  })
