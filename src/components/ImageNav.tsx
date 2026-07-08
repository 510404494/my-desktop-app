import { useState, useEffect, useCallback } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import Terminal from './Terminal'
import DbManager from './DbManager'

type ImageNavTab = 'images' | 'server' | 'db'

const STORAGE_KEY = 'image_metadata'
const BASE_URL = 'https://apppic.mymlsoft.com'
const DATA_PREFIX = '/data/apppic/'

interface ImageVariant {
  filename: string
  type: 'base' | 'active' | 'mode_active' | 'color' | 'state'
  mode?: string
}

interface ImageMetadata {
  alias: string
  type: string
  remark: string
}

interface ImageGroup {
  id: string
  baseFilename: string
  variants: ImageVariant[]
  isExpanded: boolean
}

interface RemoteFile {
  name: string
  isDir: boolean
  size?: string
  date?: string
}

function loadMetadata(): Record<string, ImageMetadata> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveMetadata(metadata: Record<string, ImageMetadata>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata))
}

function parseVariant(filename: string): { prefix: string; variant: ImageVariant } {
  const name = filename.replace('.png', '')
  
  const modeActiveMatch = name.match(/^(.+)_(chushi|jiankangfeng|songfeng|zhileng|zhire)_active$/)
  if (modeActiveMatch) {
    return {
      prefix: modeActiveMatch[1],
      variant: {
        filename,
        type: 'mode_active',
        mode: modeActiveMatch[2],
      },
    }
  }
  
  if (name.endsWith('_active')) {
    return {
      prefix: name.slice(0, -7),
      variant: { filename, type: 'active' },
    }
  }
  
  if (name.endsWith('_off') || name.endsWith('_on')) {
    return {
      prefix: name.slice(0, -4),
      variant: { filename, type: 'state', mode: name.slice(-3) },
    }
  }
  
  if (name.endsWith('_white')) {
    return {
      prefix: name.slice(0, -6),
      variant: { filename, type: 'color', mode: 'white' },
    }
  }
  
  return {
    prefix: name,
    variant: { filename, type: 'base' },
  }
}

function groupImages(filenames: string[]): ImageGroup[] {
  const groups: Record<string, ImageGroup> = {}
  
  filenames.forEach(filename => {
    const { prefix, variant } = parseVariant(filename)
    
    if (!groups[prefix]) {
      groups[prefix] = {
        id: prefix,
        baseFilename: `${prefix}.png`,
        variants: [],
        isExpanded: false,
      }
    }
    
    groups[prefix].variants.push(variant)
  })
  
  Object.values(groups).forEach(group => {
    group.variants.sort((a, b) => {
      const typeOrder = { base: 0, active: 1, mode_active: 2, color: 3, state: 4 }
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type]
      }
      if (a.mode && b.mode) {
        return a.mode.localeCompare(b.mode)
      }
      return a.filename.localeCompare(b.filename)
    })
    
    const baseVariant = group.variants.find(v => v.type === 'base')
    if (baseVariant) {
      group.baseFilename = baseVariant.filename
    } else {
      group.baseFilename = group.variants[0]?.filename || `${group.id}.png`
    }
  })
  
  return Object.values(groups).sort((a, b) => a.id.localeCompare(b.id))
}

function parseLsOutput(output: string): RemoteFile[] {
  const lines = output.split('\n').filter(line => line.trim().length > 0)
  
  return lines.map(line => {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) {
      return { name: line.trim(), isDir: false }
    }
    
    const permissions = parts[0]
    const isDir = permissions.startsWith('d')
    const name = parts.slice(8).join(' ')
    
    return {
      name,
      isDir,
      size: parts[4],
      date: `${parts[5]} ${parts[6]}`,
    }
  }).filter(file => file.name !== '.' && file.name !== '..')
}

function PicNav() {
  const [groups, setGroups] = useState<ImageGroup[]>([])
  const [selectedPic, setSelectedPic] = useState<string | null>(null)
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number; size: string; date: string } | null>(null)
  const [metadata, setMetadata] = useState<Record<string, ImageMetadata>>({})
  const [filter, setFilter] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingMetadata, setEditingMetadata] = useState<ImageMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentPath, setCurrentPath] = useState('/data/apppic/newsmarthome/new_functions')
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([])
  const [isServerConnected, setIsServerConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [showDirList, setShowDirList] = useState(false)
  const [imageDirectories, setImageDirectories] = useState<{ name: string; path: string }[]>([])
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ImageNavTab>('images')

  useEffect(() => {
    const savedMetadata = loadMetadata()
    setMetadata(savedMetadata)
    loadImages(currentPath)
    checkConnection()
    loadImageDirectories()
  }, [])

  async function checkConnection() {
    if (!isTauri()) return
    try {
      const connected = await invoke<boolean>('terminal_is_connected')
      setIsServerConnected(connected)
    } catch {
      setIsServerConnected(false)
    }
  }

  async function loadImageDirectories() {
    if (!isTauri()) {
      const dirs = [
        { name: 'newsmarthome', path: '/data/apppic/newsmarthome' },
        { name: 'new_functions', path: '/data/apppic/newsmarthome/new_functions' },
      ]
      setImageDirectories(dirs)
      return
    }

    try {
      const result = await invoke<string>('get_path_list')
      const paths = JSON.parse(result) as { name: string; path: string }[]
      if (paths.length > 0) {
        setImageDirectories(paths)
      } else {
        const dirs = [
          { name: 'newsmarthome', path: '/data/apppic/newsmarthome' },
          { name: 'new_functions', path: '/data/apppic/newsmarthome/new_functions' },
        ]
        setImageDirectories(dirs)
      }
    } catch {
      const dirs = [
        { name: 'newsmarthome', path: '/data/apppic/newsmarthome' },
        { name: 'new_functions', path: '/data/apppic/newsmarthome/new_functions' },
      ]
      setImageDirectories(dirs)
    }
  }

  const loadImages = useCallback(async (path?: string) => {
    if (!isTauri()) return

    setLoading(true)

    try {
      const targetPath = path || currentPath
      const files = await invoke<string[]>('get_image_files_by_path', { path: targetPath })

      if (files && files.length > 0) {
        const imageGroups = groupImages(files)
        setGroups(imageGroups)
      } else {
        setGroups([])
      }
    } catch (err) {
      console.error('加载图片失败:', err)
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [currentPath])

  const loadRemoteFiles = useCallback(async () => {
    if (!isTauri() || !isServerConnected) return

    try {
      const result = await invoke<string>('terminal_list_files', { path: currentPath })
      const files = parseLsOutput(result)
      setRemoteFiles(files)
    } catch (err) {
      console.error('加载远程文件失败:', err)
    }
  }, [currentPath, isServerConnected])

  const toggleGroup = useCallback((groupId: string) => {
    setGroups(prev => prev.map(group =>
      group.id === groupId ? { ...group, isExpanded: !group.isExpanded } : group
    ))
  }, [])

  const handleStartEdit = useCallback((groupId: string) => {
    setEditingGroupId(groupId)
    const group = groups.find(g => g.id === groupId)
    if (group && group.variants.length > 0) {
      const firstVariant = group.variants[0]
      const existing = metadata[firstVariant.filename] || { alias: groupId, type: '', remark: '' }
      setEditingMetadata({ ...existing })
    }
  }, [groups, metadata])

  const handleEndEdit = useCallback((groupId: string) => {
    setEditingGroupId(null)
    const group = groups.find(g => g.id === groupId)
    if (!group || !editingMetadata) return
    
    const newMetadata = { ...metadata }
    group.variants.forEach(v => {
      newMetadata[v.filename] = { ...editingMetadata }
    })
    
    if (JSON.stringify(metadata) !== JSON.stringify(newMetadata)) {
      setMetadata(newMetadata)
      saveMetadata(newMetadata)
    }
    setEditingMetadata(null)
  }, [groups, metadata, editingMetadata])

  const handleCopyPath = useCallback(async (filename: string) => {
    try {
      let urlPath = currentPath
      if (urlPath.startsWith(DATA_PREFIX)) {
        urlPath = urlPath.substring(DATA_PREFIX.length)
      }
      if (!urlPath.startsWith('/')) {
        urlPath = '/' + urlPath
      }
      if (!urlPath.endsWith('/')) {
        urlPath = urlPath + '/'
      }
      const url = `${BASE_URL}${urlPath}${filename}`
      await navigator.clipboard.writeText(url)
      setCopiedPath(filename)
      setTimeout(() => setCopiedPath(null), 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }, [currentPath])

  const getPicUrl = (filename: string) => {
    let urlPath = currentPath
    if (urlPath.startsWith(DATA_PREFIX)) {
      urlPath = urlPath.substring(DATA_PREFIX.length)
    }
    if (!urlPath.startsWith('/')) {
      urlPath = '/' + urlPath
    }
    if (!urlPath.endsWith('/')) {
      urlPath = urlPath + '/'
    }
    return `${BASE_URL}${urlPath}${filename}`
  }

  const getDisplayName = (groupId: string) => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return groupId
    
    const firstVariant = group.variants[0]
    const meta = metadata[firstVariant.filename]
    if (meta && meta.alias) return meta.alias
    return groupId
  }

  const getImageType = (groupId: string): string => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return ''
    
    const firstVariant = group.variants[0]
    const meta = metadata[firstVariant.filename]
    return meta?.type || ''
  }

  const getImageRemark = (groupId: string): string => {
    const group = groups.find(g => g.id === groupId)
    if (!group) return ''
    
    const firstVariant = group.variants[0]
    const meta = metadata[firstVariant.filename]
    return meta?.remark || ''
  }

  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MCIgaGVpZ2h0PSI4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMmQzNzQ4Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWFsaWduPSJtaWRkbGUiIGZpbGw9IiM3MTgwOTYiIGZvbnQtc2l6ZT0iMTIiPk5vdCBGb3VuZDwvdGV4dD48L3N2Zz4='
  }

  const handleImageLoad = async (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const width = img.naturalWidth
    const height = img.naturalHeight
    
    if (!isTauri() || !isServerConnected || !selectedPic) {
      setImageInfo({ width, height, size: '未知', date: '未知' })
      return
    }

    try {
      const filePath = `${currentPath}/${selectedPic}`
      const result = await invoke<string>('terminal_file_info', { file_path: filePath })
      
      const lines = result.split('\n').filter(line => line.trim().length > 0)
      let size = '未知'
      let date = '未知'
      
      for (const line of lines) {
        if (line.includes(selectedPic)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 9) {
            size = parts[4]
            date = `${parts[5]} ${parts[6]}`
          } else if (parts.length >= 2) {
            size = parts[0]
            date = parts[1]
          }
          break
        }
      }
      
      setImageInfo({ width, height, size, date })
    } catch {
      setImageInfo({ width, height, size: '未知', date: '未知' })
    }
  }

  const handleDirSelect = useCallback((dir: { name: string; path: string }) => {
    setCurrentPath(dir.path)
    loadImages(dir.path)
  }, [loadImages])

  const handleSync = useCallback(async () => {
    if (!isTauri() || !isServerConnected) {
      setSyncResult(isServerConnected ? '请在 Tauri 桌面应用中运行此功能' : '请先连接服务器')
      return
    }

    setSyncing(true)
    setSyncResult(null)

    try {
      const result = await invoke<string>('terminal_send', {
        command: `ls -1 "${currentPath}"/*.png "${currentPath}"/*.jpg "${currentPath}"/*.jpeg 2>/dev/null || find "${currentPath}" -maxdepth 1 -type f \\( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \\) 2>/dev/null`,
      })

      const lines = result.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => line.endsWith('.png') || line.endsWith('.jpg') || line.endsWith('.jpeg'))
        .map(line => {
          const lastSlash = line.lastIndexOf('/')
          if (lastSlash >= 0) {
            return line.substring(lastSlash + 1)
          }
          return line
        })

      await invoke('save_image_path', { path: currentPath })
      await invoke('save_image_files', { files: lines, path: currentPath })

      const pathName = currentPath.split('/').filter(p => p).pop() || '未知目录'
      await invoke('add_path', { name: pathName, path: currentPath })

      setSyncResult(`同步成功！共 ${lines.length} 个文件`)
      await loadImages()
    } catch (err) {
      setSyncResult(`同步失败: ${err}`)
    } finally {
      setSyncing(false)
    }
  }, [currentPath, isServerConnected, loadImages])

  const filteredGroups = filter
    ? groups.filter(group => {
        const lowerFilter = filter.toLowerCase()
        return (
          group.id.toLowerCase().includes(lowerFilter) ||
          getDisplayName(group.id).toLowerCase().includes(lowerFilter) ||
          group.variants.some(v => v.filename.toLowerCase().includes(lowerFilter))
        )
      })
    : groups

  const getVariantLabel = (variant: ImageVariant): string => {
    return variant.filename.replace('.png', '')
  }

  const handleToggleDirList = useCallback(() => {
    if (showDirList) {
      setShowDirList(false)
    } else {
      loadRemoteFiles()
      setShowDirList(true)
    }
  }, [showDirList, loadRemoteFiles])

  return (
    <div className="image-nav-container">
      <div className="image-nav-sidebar">
        <div className="sidebar-header">
          <span>📁</span>
          <span>目录列表</span>
        </div>
        <div className="sidebar-content">
          {imageDirectories.map(dir => (
            <div
              key={dir.path}
              className={`sidebar-item ${currentPath === dir.path ? 'active' : ''}`}
              onClick={() => handleDirSelect(dir)}
            >
              <span className="sidebar-icon">📂</span>
              <span className="sidebar-name">{dir.name}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="image-nav">
        <div className="image-nav-header">
          <div className="image-nav-tabs">
            <button
              className={`image-nav-tab ${activeTab === 'images' ? 'active' : ''}`}
              onClick={() => setActiveTab('images')}
            >
              🖼️ 图片
            </button>
            <button
              className={`image-nav-tab ${activeTab === 'server' ? 'active' : ''}`}
              onClick={() => setActiveTab('server')}
            >
              🖥️ 服务器
            </button>
            <button
              className={`image-nav-tab ${activeTab === 'db' ? 'active' : ''}`}
              onClick={() => setActiveTab('db')}
            >
              📊 数据库
            </button>
          </div>
          
          {activeTab === 'images' && (
            <>
              <span className="image-nav-current-path">{currentPath}</span>
              <div className="image-nav-controls">
                <button 
                  className="btn-secondary" 
                  onClick={handleToggleDirList}
                  disabled={!isServerConnected}
                >
                  {showDirList ? '◀' : '📁'} {showDirList ? '隐藏目录' : '目录列表'}
                </button>
                <button
                  className="btn-accent"
                  onClick={handleSync}
                  disabled={syncing || !isServerConnected}
                >
                  {syncing ? '⏳' : '🔄'} 同步图片
                </button>
                {syncResult && (
                  <div className={`sync-result ${syncResult.includes('成功') ? 'success' : 'error'}`}>
                    <span className="result-icon">{syncResult.includes('成功') ? '✓' : '✗'}</span>
                    <span className="result-message">{syncResult}</span>
                  </div>
                )}
              </div>
              <input
                className="image-nav-filter"
                type="text"
                placeholder="搜索图片..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              <span className="image-nav-count">{filteredGroups.length} 个分组</span>
            </>
          )}
        </div>
        
        {activeTab === 'images' && showDirList && isServerConnected && (
          <div className="image-nav-dir-list">
            <div className="dir-list-header">
              <span>远程目录: {currentPath}</span>
            </div>
            <div className="dir-list-content">
              {currentPath !== '/' && (
                <div 
                  className="dir-list-item dir-list-parent"
                  onClick={() => {
                    const parts = currentPath.split('/').filter(Boolean)
                    parts.pop()
                    const newPath = '/' + parts.join('/') || '/'
                    setCurrentPath(newPath)
                  }}
                >
                  <span className="dir-icon">📂</span>
                  <span>..</span>
                </div>
              )}
              {remoteFiles.map(file => (
                <div
                  key={file.name}
                  className={`dir-list-item ${file.isDir ? 'is-dir' : 'is-file'}`}
                  onClick={() => {
                    if (file.isDir) {
                      const newPath = currentPath === '/' 
                        ? '/' + file.name 
                        : currentPath + '/' + file.name
                      setCurrentPath(newPath)
                    }
                  }}
                >
                  <span className="dir-icon">{file.isDir ? '📁' : '📄'}</span>
                  <span className="dir-name">{file.name}</span>
                  {file.size && <span className="dir-size">{file.size}</span>}
                  {file.date && <span className="dir-date">{file.date}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === 'images' && (loading ? (
          <div className="image-nav-loading">
            <span className="loading-icon">⏳</span>
            <span>加载中...</span>
          </div>
        ) : (
          <div className="image-nav-grid">
            {filteredGroups.map(group => (
              <div key={group.id} className="image-nav-item">
                <div className="image-nav-thumbnail"
                  onClick={() => setSelectedPic(group.baseFilename)}
                  title="点击预览"
                >
                  <img
                    src={getPicUrl(group.baseFilename)}
                    alt={getDisplayName(group.id)}
                    loading="lazy"
                    onError={handleImgError}
                  />
                  {group.variants.length > 1 && (
                    <>
                      <div className="image-nav-variant-badge">
                        {group.variants.length}
                      </div>
                      <div 
                        className={`image-nav-expand-btn ${group.isExpanded ? 'expanded' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleGroup(group.id)
                        }}
                        title={group.isExpanded ? '收起' : '展开查看更多'}
                      >
                        {group.isExpanded ? '▲' : '▼'}
                      </div>
                    </>
                  )}
                </div>
                <div className="image-nav-info">
                  {editingGroupId === group.id && editingMetadata ? (
                    <div className="image-nav-edit-form">
                      <input
                        type="text"
                        className="image-nav-edit-input image-nav-edit-alias"
                        placeholder="别名"
                        value={editingMetadata.alias}
                        onChange={(e) => setEditingMetadata({ ...editingMetadata, alias: e.target.value })}
                        autoFocus
                      />
                      <input
                        type="text"
                        className="image-nav-edit-input image-nav-edit-type"
                        placeholder="类型"
                        value={editingMetadata.type}
                        onChange={(e) => setEditingMetadata({ ...editingMetadata, type: e.target.value })}
                      />
                      <textarea
                        className="image-nav-edit-input image-nav-edit-remark"
                        placeholder="备注"
                        value={editingMetadata.remark}
                        onChange={(e) => setEditingMetadata({ ...editingMetadata, remark: e.target.value })}
                        rows={2}
                      />
                      <div className="image-nav-edit-actions">
                        <button className="btn-primary btn-small" onClick={() => handleEndEdit(group.id)}>保存</button>
                        <button className="btn-secondary btn-small" onClick={() => { setEditingGroupId(null); setEditingMetadata(null); }}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className="image-nav-name"
                        onClick={() => handleStartEdit(group.id)}
                        title="点击编辑信息"
                      >
                        {getDisplayName(group.id)}
                      </span>
                      {getImageType(group.id) && (
                        <span className="image-nav-type" title="图片类型">
                          {getImageType(group.id)}
                        </span>
                      )}
                      <span className="image-nav-filename" title={group.id}>
                        {group.id}
                      </span>
                      {getImageRemark(group.id) && (
                        <span className="image-nav-remark" title={getImageRemark(group.id)}>
                          💬 {getImageRemark(group.id)}
                        </span>
                      )}
                      <button 
                        className="image-nav-copy-btn"
                        onClick={() => handleCopyPath(group.baseFilename)}
                        title="复制图片路径"
                      >
                        {copiedPath === group.baseFilename ? '✓' : '📋'}
                      </button>
                    </>
                  )}
                </div>
                
                {group.isExpanded && group.variants.length > 1 && (
                  <div className="image-nav-variants">
                    {group.variants.map(variant => (
                      <div
                        key={variant.filename}
                        className="image-nav-variant"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedPic(variant.filename)
                        }}
                      >
                        <img
                          src={getPicUrl(variant.filename)}
                          alt={getVariantLabel(variant)}
                          loading="lazy"
                          onError={handleImgError}
                        />
                        <span className="image-nav-variant-label" title={variant.filename}>
                          {getVariantLabel(variant)}
                        </span>
                        <button 
                          className="image-nav-variant-copy"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCopyPath(variant.filename)
                          }}
                          title="复制路径"
                        >
                          {copiedPath === variant.filename ? '✓' : '📋'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            
            {filteredGroups.length === 0 && !loading && (
              <div className="image-nav-empty">
                <div className="empty-icon">📷</div>
                <p>暂无图片</p>
                <p className="empty-hint">请点击同步图片按钮</p>
              </div>
            )}
          </div>
        ))}
        
        {activeTab === 'server' && (
          <div className="image-nav-server-panel">
            <div className="server-sync-bar">
              <input
                className="server-path-input"
                type="text"
                placeholder="远程路径..."
                value={currentPath}
                onChange={e => setCurrentPath(e.target.value)}
              />
              <button
                className="btn-accent"
                onClick={handleSync}
                disabled={syncing || !isServerConnected}
              >
                {syncing ? '⏳' : '🔄'} 同步图片
              </button>
              {syncResult && (
                <div className={`sync-result ${syncResult.includes('成功') ? 'success' : 'error'}`}>
                  <span className="result-icon">{syncResult.includes('成功') ? '✓' : '✗'}</span>
                  <span className="result-message">{syncResult}</span>
                </div>
              )}
            </div>
            <Terminal 
          server={{
            id: 'huawei-cloud',
            name: '华为云',
            host: 'hw-jump-koko.mymlsoft.com',
            port: 2222,
            username: 'wangchuan',
            password: 'Wangchuan@12345',
          }}
          onConnect={() => setIsServerConnected(true)}
          onDisconnect={() => setIsServerConnected(false)}
          onPathChange={setCurrentPath}
          defaultRemotePath={currentPath}
        />
          </div>
        )}
        
        {activeTab === 'db' && (
          <div className="image-nav-db-panel">
            <DbManager />
          </div>
        )}

        {selectedPic && (
          <div className="image-modal" onClick={() => setSelectedPic(null)}>
            <button className="image-modal-close" onClick={() => setSelectedPic(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
              <img
                src={getPicUrl(selectedPic)}
                alt={selectedPic}
                onError={handleImgError}
                onLoad={handleImageLoad}
              />
              <div className="image-modal-name">{selectedPic}</div>
              {imageInfo && (
                <div className="image-modal-info">
                  <span className="image-info-item">📐 {imageInfo.width} × {imageInfo.height}</span>
                  <span className="image-info-item">📦 {imageInfo.size} bytes</span>
                  <span className="image-info-item">📅 {imageInfo.date}</span>
                </div>
              )}
              {editingGroupId && editingMetadata ? (
                <div className="image-modal-edit">
                  <input
                    type="text"
                    className="image-modal-edit-input"
                    placeholder="别名"
                    value={editingMetadata.alias}
                    onChange={(e) => setEditingMetadata({ ...editingMetadata, alias: e.target.value })}
                  />
                  <input
                    type="text"
                    className="image-modal-edit-input"
                    placeholder="类型"
                    value={editingMetadata.type}
                    onChange={(e) => setEditingMetadata({ ...editingMetadata, type: e.target.value })}
                  />
                  <textarea
                    className="image-modal-edit-input image-modal-edit-textarea"
                    placeholder="备注"
                    value={editingMetadata.remark}
                    onChange={(e) => setEditingMetadata({ ...editingMetadata, remark: e.target.value })}
                    rows={3}
                  />
                  <div className="image-modal-edit-actions">
                    <button className="btn-primary btn-small" onClick={() => handleEndEdit(editingGroupId)}>保存</button>
                    <button className="btn-secondary btn-small" onClick={() => { setEditingGroupId(null); setEditingMetadata(null); }}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="image-modal-actions">
                  <button className="image-modal-edit-btn" onClick={(e) => {
                    e.stopPropagation()
                    const group = groups.find(g => g.variants.some(v => v.filename === selectedPic))
                    if (group) {
                      handleStartEdit(group.id)
                    }
                  }}>
                    ✏️ 编辑信息
                  </button>
                  <button className="image-modal-copy" onClick={(e) => {
                    e.stopPropagation()
                    handleCopyPath(selectedPic)
                  }}>
                    {copiedPath === selectedPic ? '✓ 已复制' : '📋 复制路径'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PicNav