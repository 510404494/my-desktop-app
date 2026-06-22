import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import JSONEditor from '@json-editor/json-editor'
import type { DeviceConfig, DeviceCategory } from './types'
import './App.css'

function App() {
  const [categories, setCategories] = useState<DeviceCategory[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DeviceConfig | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstance = useRef<JSONEditor | null>(null)

  useEffect(() => {
    loadConfig()
  }, [])

  useEffect(() => {
    if (selectedDevice && editorRef.current) {
      if (editorInstance.current) {
        editorInstance.current.destroy()
      }

      editorInstance.current = new JSONEditor(editorRef.current, {
        schema: generateSchema(selectedDevice.data),
        startval: selectedDevice.data,
        theme: 'bootstrap4',
        iconlib: 'fontawesome5',
        compact: true,
      })

      editorInstance.current.on('change', () => {
        if (editorInstance.current && selectedDevice) {
          const newData = editorInstance.current.getValue()
          saveDevice(selectedDevice.filePath, newData)
        }
      })
    }

    return () => {
      if (editorInstance.current) {
        editorInstance.current.destroy()
        editorInstance.current = null
      }
    }
  }, [selectedDevice])

  async function loadConfig() {
    try {
      const config = await invoke<{ scanPaths: string[] }>('load_config')
      if (config.scanPaths[0]) {
        scanDirectory(config.scanPaths[0])
      }
    } catch {
      console.log('No config found')
    }
  }

  async function scanDirectory(path: string) {
    try {
      const devices = await invoke<DeviceConfig[]>('scan_directory', { path })
      const grouped = groupByType(devices)
      setCategories(grouped)
      await invoke('save_config', { scanPaths: [path] })
    } catch (err) {
      console.error('Scan failed:', err)
    }
  }

  function groupByType(devices: DeviceConfig[]): DeviceCategory[] {
    const map = new Map<string, DeviceConfig[]>()
    devices.forEach(d => {
      const list = map.get(d.type) || []
      list.push(d)
      map.set(d.type, list)
    })
    return Array.from(map.entries()).map(([name, devices]) => ({ name, devices }))
  }

  function generateSchema(data: Record<string, unknown>) {
    const properties: Record<string, unknown> = {}
    Object.keys(data).forEach(key => {
      const value = data[key]
      if (typeof value === 'string') {
        properties[key] = { type: 'string', title: key }
      } else if (typeof value === 'number') {
        properties[key] = { type: 'number', title: key }
      } else if (typeof value === 'boolean') {
        properties[key] = { type: 'boolean', title: key }
      } else {
        properties[key] = { type: 'string', title: key, format: 'textarea' }
      }
    })
    return {
      type: 'object',
      properties,
    }
  }

  async function saveDevice(filePath: string, data: Record<string, unknown>) {
    try {
      await invoke('save_device', { filePath, data })
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  async function handleSelectFolder() {
    const selected = await open({ directory: true })
    if (selected) {
      scanDirectory(selected)
    }
  }

  async function handleOpenFile() {
    const selected = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    })
    if (selected) {
      try {
        const device = await invoke<DeviceConfig>('load_file', { path: selected })
        setSelectedDevice(device)
      } catch (err) {
        console.error('Load failed:', err)
      }
    }
  }

  const filteredCategories = categories.map(cat => ({
    ...cat,
    devices: cat.devices.filter(d =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.type.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(cat => cat.devices.length > 0)

  return (
    <div className="app">
      <header className="header">
        <h1>JSON Config Editor</h1>
        <div className="toolbar">
          <button onClick={handleSelectFolder}>📁 扫描文件夹</button>
          <button onClick={handleOpenFile}>📄 打开文件</button>
          <input
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          {filteredCategories.map(cat => (
            <div key={cat.name} className="category">
              <h3>{cat.name}</h3>
              <ul>
                {cat.devices.map(device => (
                  <li
                    key={device.id}
                    className={selectedDevice?.id === device.id ? 'active' : ''}
                    onClick={() => setSelectedDevice(device)}
                  >
                    {device.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <main className="editor-panel">
          {selectedDevice ? (
            <>
              <div className="editor-header">
                <h2>{selectedDevice.name}</h2>
                <span className="badge">{selectedDevice.type}</span>
                <code className="path">{selectedDevice.filePath}</code>
              </div>
              <div ref={editorRef} className="json-editor-container" />
            </>
          ) : (
            <div className="empty-state">
              <p>选择设备或打开JSON文件开始编辑</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
