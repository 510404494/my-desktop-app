import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

interface Item {
  id: number
  name: string
  created_at: string
}

function App() {
  const [items, setItems] = useState<Item[]>([])
  const [newName, setNewName] = useState('')

  useEffect(() => {
    invoke('init_db').then(() => loadItems())
  }, [])

  async function loadItems() {
    const result = await invoke<Item[]>('get_items')
    setItems(result)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    await invoke('add_item', { name: newName })
    setNewName('')
    loadItems()
  }

  async function handleDelete(id: number) {
    await invoke('delete_item', { id })
    loadItems()
  }

  return (
    <div className="container">
      <h1>SQLite Demo</h1>
      <div className="input-row">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="输入名称"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button onClick={handleAdd}>添加</button>
      </div>
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <span>{item.name}</span>
            <span className="time">{item.created_at}</span>
            <button onClick={() => handleDelete(item.id)}>删除</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
