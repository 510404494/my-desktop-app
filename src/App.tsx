import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import JSONEditor from '@json-editor/json-editor'
import type { DeviceConfig, DeviceCategory } from './types'
import './App.css'

type ViewMode = 'form' | 'raw'

function App() {
  const [categories, setCategories] = useState<DeviceCategory[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DeviceConfig | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('form')
  const [rawJson, setRawJson] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstance = useRef<JSONEditor | null>(null)

  useEffect(() => {
    loadConfig()
  }, [])

  const destroyEditor = useCallback(() => {
    if (editorInstance.current) {
      try {
        editorInstance.current.destroy()
      } catch {}
      editorInstance.current = null
    }
  }, [])

  useEffect(() => {
    if (selectedDevice && editorRef.current && viewMode === 'form') {
      destroyEditor()

      try {
        const schema = generateSchema(selectedDevice.data)

        editorInstance.current = new JSONEditor(editorRef.current, {
          schema,
          startval: selectedDevice.data,
          theme: 'bootstrap4',
          iconlib: 'fontawesome5',
          compact: true,
          disable_edit_json: true,
          disable_properties: true,
          disable_array_reorder: true,
        })

        editorInstance.current.on('change', () => {
          if (editorInstance.current && selectedDevice) {
            try {
              const newData = editorInstance.current.getValue()
              saveDevice(selectedDevice.filePath, newData)
            } catch (err) {
              console.error('Auto-save failed:', err)
            }
          }
        })
      } catch (err) {
        console.error('Editor init failed:', err)
        setError('表单渲染失败，已切换到原始编辑模式')
        setViewMode('raw')
        setRawJson(JSON.stringify(selectedDevice.data, null, 2))
      }
    }

    if (viewMode === 'raw' && selectedDevice) {
      setRawJson(JSON.stringify(selectedDevice.data, null, 2))
    }

    return () => destroyEditor()
  }, [selectedDevice, viewMode, destroyEditor])

  async function loadConfig() {
    try {
      const config = await invoke<{ scanPaths: string[] }>('load_config')
      if (config.scanPaths[0]) {
        scanDirectory(config.scanPaths[0])
      }
    } catch {
      // No config yet
    }
  }

  async function scanDirectory(path: string) {
    try {
      const devices = await invoke<DeviceConfig[]>('scan_directory', { path })
      const grouped = groupByType(devices)
      setCategories(grouped)
      await invoke('save_config', { scanPaths: [path] })
    } catch (err) {
      setError(`扫描失败: ${err}`)
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

  function generateSchema(data: unknown, depth = 0): Record<string, unknown> {
    if (depth > 5) return { type: 'string', title: 'Value', format: 'textarea' }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { type: 'array', items: { type: 'string' } }
      }
      return {
        type: 'array',
        items: generateSchema(data[0], depth + 1),
      }
    }

    if (data !== null && typeof data === 'object') {
      const properties: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        properties[key] = generateSchema(value, depth + 1)
      }
      return { type: 'object', properties }
    }

    if (typeof data === 'number') {
      return Number.isInteger(data)
        ? { type: 'integer', title: 'Value' }
        : { type: 'number', title: 'Value' }
    }

    if (typeof data === 'boolean') {
      return { type: 'boolean', title: 'Value' }
    }

    return { type: 'string', title: 'Value' }
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
        setError(null)
        const device = await invoke<DeviceConfig>('load_file', { path: selected })
        setSelectedDevice(device)
        setViewMode('form')
      } catch (err) {
        setError(`打开文件失败: ${err}`)
      }
    }
  }

  async function handleFetchUrl() {
    if (!urlInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<Record<string, unknown>>('fetch_json_from_url', { url: urlInput })
      const name = urlInput.split('/').pop()?.split('?')[0] || 'URL Import'
      const device: DeviceConfig = {
        id: crypto.randomUUID(),
        name,
        type: 'url',
        filePath: urlInput,
        data,
      }
      setSelectedDevice(device)
      setViewMode('form')
    } catch (err) {
      setError(`获取URL失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleExportJson() {
    if (!selectedDevice) return
    try {
      const path = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: `${selectedDevice.name}.json`,
      })
      if (path) {
        await invoke('export_to_json', { data: selectedDevice.data, path })
      }
    } catch (err) {
      setError(`导出失败: ${err}`)
    }
  }

  async function handleExportCsv() {
    if (!selectedDevice) return
    try {
      const path = await save({
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        defaultPath: `${selectedDevice.name}.csv`,
      })
      if (path) {
        await invoke('export_to_csv', { data: selectedDevice.data, path })
      }
    } catch (err) {
      setError(`导出失败: ${err}`)
    }
  }

  function handleRefresh() {
    setError(null)
    setViewMode('form')
    if (selectedDevice) {
      setSelectedDevice({ ...selectedDevice })
    }
  }

  function handleRawSave() {
    if (!selectedDevice) return
    try {
      const data = JSON.parse(rawJson)
      setSelectedDevice({ ...selectedDevice, data })
      saveDevice(selectedDevice.filePath, data)
      setError(null)
    } catch (err) {
      setError(`JSON格式错误: ${err}`)
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
          <div className="url-input">
            <input
              type="text"
              placeholder="输入JSON URL..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetchUrl()}
            />
            <button onClick={handleFetchUrl} disabled={loading}>
              {loading ? '⏳' : '🔗'} 解析
            </button>
          </div>
          <input
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

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
                    onClick={() => {
                      setSelectedDevice(device)
                      setError(null)
                      setViewMode('form')
                    }}
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
                <div className="header-actions">
                  <div className="view-toggle">
                    <button
                      className={viewMode === 'form' ? 'active' : ''}
                      onClick={() => setViewMode('form')}
                    >
                      表单
                    </button>
                    <button
                      className={viewMode === 'raw' ? 'active' : ''}
                      onClick={() => setViewMode('raw')}
                    >
                      原始
                    </button>
                  </div>
                  <button onClick={handleRefresh} title="刷新">🔄</button>
                  <button onClick={handleExportJson}>导出JSON</button>
                  <button onClick={handleExportCsv}>导出CSV</button>
                </div>
              </div>
              {viewMode === 'form' ? (
                <div ref={editorRef} className="json-editor-container" />
              ) : (
                <div className="raw-editor">
                  <textarea
                    value={rawJson}
                    onChange={e => setRawJson(e.target.value)}
                    spellCheck={false}
                  />
                  <button className="raw-save-btn" onClick={handleRawSave}>
                    保存修改
                  </button>
                </div>
              )}
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
