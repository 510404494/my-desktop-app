import { useState, useEffect, useCallback } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'

interface TableInfo {
  name: string
  count: number
}

interface TableRow {
  [key: string]: string
}

interface EditRow {
  [key: string]: string
}

function DbManager() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [tableData, setTableData] = useState<TableRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null)
  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [editData, setEditData] = useState<EditRow>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [addData, setAddData] = useState<EditRow>({})

  const loadTables = useCallback(async () => {
    if (!isTauri()) return

    setLoading(true)
    try {
      const result = await invoke<string>('get_db_tables')
      const tableList = JSON.parse(result) as { name: string; count: number }[]
      setTables(tableList)
    } catch (err) {
      console.error('加载表失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTableData = useCallback(async (tableName: string) => {
    if (!isTauri()) return

    setLoading(true)
    try {
      const result = await invoke<string>('get_table_data', { table: tableName })
      const data = JSON.parse(result) as { columns: string[]; rows: TableRow[] }
      setColumns(data.columns)
      setTableData(data.rows)
      setSelectedTable(tableName)
      setEditingRow(null)
      setShowAddForm(false)
    } catch (err) {
      console.error('加载表数据失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const clearTableData = useCallback(async (tableName: string) => {
    if (!isTauri()) return

    if (!confirm(`确定要清空表 ${tableName} 吗？此操作不可撤销。`)) {
      return
    }

    setLoading(true)
    try {
      await invoke('clear_table', { table: tableName })
      setActionResult({ success: true, message: `表 ${tableName} 已清空` })
      await loadTables()
      if (selectedTable === tableName) {
        setTableData([])
        setColumns([])
        setSelectedTable(null)
      }
    } catch (err) {
      setActionResult({ success: false, message: `清空失败: ${err}` })
    } finally {
      setLoading(false)
      setTimeout(() => setActionResult(null), 3000)
    }
  }, [selectedTable, loadTables])

  const resetDatabase = useCallback(async () => {
    if (!isTauri()) return

    if (!confirm('确定要重置整个数据库吗？所有数据将被删除！此操作不可撤销。')) {
      return
    }

    setLoading(true)
    try {
      await invoke('reset_db')
      setActionResult({ success: true, message: '数据库已重置' })
      setTables([])
      setTableData([])
      setColumns([])
      setSelectedTable(null)
      await loadTables()
    } catch (err) {
      setActionResult({ success: false, message: `重置失败: ${err}` })
    } finally {
      setLoading(false)
      setTimeout(() => setActionResult(null), 3000)
    }
  }, [loadTables])

  const handleStartEdit = useCallback((rowIndex: number) => {
    const row = tableData[rowIndex]
    setEditData({ ...row })
    setEditingRow(rowIndex)
  }, [tableData])

  const handleSaveEdit = useCallback(async () => {
    if (!selectedTable || editingRow === null) return

    const row = tableData[editingRow]
    const rowId = parseInt(row.id || '0')
    if (isNaN(rowId)) return

    const editableCols = columns.filter(c => c !== 'id')
    const colValues = editableCols.map(c => editData[c] || '')

    setLoading(true)
    try {
      await invoke('update_row', {
        table: selectedTable,
        id: rowId,
        columns: editableCols,
        values: colValues,
      })
      setActionResult({ success: true, message: '更新成功' })
      await loadTableData(selectedTable)
    } catch (err) {
      setActionResult({ success: false, message: `更新失败: ${err}` })
    } finally {
      setLoading(false)
      setTimeout(() => setActionResult(null), 3000)
    }
  }, [selectedTable, editingRow, tableData, columns, editData, loadTableData])

  const handleCancelEdit = useCallback(() => {
    setEditingRow(null)
    setEditData({})
  }, [])

  const handleDeleteRow = useCallback(async (rowIndex: number) => {
    if (!selectedTable) return

    const row = tableData[rowIndex]
    const rowId = parseInt(row.id || '0')
    if (isNaN(rowId)) return

    if (!confirm(`确定要删除ID为 ${rowId} 的记录吗？`)) {
      return
    }

    setLoading(true)
    try {
      await invoke('delete_row', {
        table: selectedTable,
        id: rowId,
      })
      setActionResult({ success: true, message: '删除成功' })
      await loadTableData(selectedTable)
    } catch (err) {
      setActionResult({ success: false, message: `删除失败: ${err}` })
    } finally {
      setLoading(false)
      setTimeout(() => setActionResult(null), 3000)
    }
  }, [selectedTable, tableData, loadTableData])

  const handleAddRow = useCallback(async () => {
    if (!selectedTable) return

    const editableCols = columns.filter(c => c !== 'id')
    const colValues = editableCols.map(c => addData[c] || '')

    setLoading(true)
    try {
      await invoke('insert_row', {
        table: selectedTable,
        columns: editableCols,
        values: colValues,
      })
      setActionResult({ success: true, message: '添加成功' })
      setShowAddForm(false)
      setAddData({})
      await loadTableData(selectedTable)
    } catch (err) {
      setActionResult({ success: false, message: `添加失败: ${err}` })
    } finally {
      setLoading(false)
      setTimeout(() => setActionResult(null), 3000)
    }
  }, [selectedTable, columns, addData, loadTableData])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  return (
    <div className="db-manager">
      <div className="db-manager-header">
        <h2>📊 数据库管理</h2>
        <button className="btn-danger" onClick={resetDatabase} disabled={loading}>
          ⚠️ 重置数据库
        </button>
      </div>

      {actionResult && (
        <div className={`action-result ${actionResult.success ? 'success' : 'error'}`}>
          <span className="result-icon">{actionResult.success ? '✓' : '✗'}</span>
          <span className="result-message">{actionResult.message}</span>
        </div>
      )}

      <div className="db-manager-content">
        <div className="db-sidebar">
          <div className="sidebar-title">
            <span>📁</span>
            <span>表列表</span>
          </div>
          <div className="sidebar-list">
            {loading ? (
              <div className="loading-text">加载中...</div>
            ) : (
              tables.map(table => (
                <div
                  key={table.name}
                  className={`sidebar-item ${selectedTable === table.name ? 'active' : ''}`}
                  onClick={() => loadTableData(table.name)}
                >
                  <span className="table-name">{table.name}</span>
                  <span className="table-count">{table.count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="db-content">
          {selectedTable ? (
            <>
              <div className="table-header">
                <h3>{selectedTable}</h3>
                <div className="table-actions">
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => {
                      setShowAddForm(true)
                      setEditingRow(null)
                    }}
                    disabled={loading}
                  >
                    ➕ 添加记录
                  </button>
                  <button
                    className="btn-secondary btn-small"
                    onClick={() => clearTableData(selectedTable)}
                    disabled={loading}
                  >
                    🗑️ 清空表
                  </button>
                </div>
              </div>

              {showAddForm && (
                <div className="add-form">
                  <h4>添加新记录</h4>
                  <div className="form-fields">
                    {columns.filter(c => c !== 'id').map(col => (
                      <div key={col} className="form-field">
                        <label>{col}</label>
                        <input
                          type="text"
                          value={addData[col] || ''}
                          onChange={e => setAddData(prev => ({ ...prev, [col]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button className="btn-primary" onClick={handleAddRow} disabled={loading}>
                      确认添加
                    </button>
                    <button className="btn-secondary" onClick={() => {
                      setShowAddForm(false)
                      setAddData({})
                    }}>
                      取消
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="loading-text">加载数据中...</div>
              ) : tableData.length > 0 ? (
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {columns.map(col => (
                          <th key={col}>{col}</th>
                        ))}
                        <th className="action-column">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((row, idx) => (
                        <tr key={idx}>
                          {columns.map(col => (
                            <td key={col}>
                              {editingRow === idx ? (
                                <input
                                  type="text"
                                  className="edit-input"
                                  value={editData[col] || ''}
                                  onChange={e => setEditData(prev => ({ ...prev, [col]: e.target.value }))}
                                />
                              ) : (
                                row[col] || '-'
                              )}
                            </td>
                          ))}
                          <td className="action-column">
                            {editingRow === idx ? (
                              <div className="row-actions">
                                <button className="btn-icon" onClick={handleSaveEdit}>✓</button>
                                <button className="btn-icon" onClick={handleCancelEdit}>✕</button>
                              </div>
                            ) : (
                              <div className="row-actions">
                                <button className="btn-icon" onClick={() => handleStartEdit(idx)}>✏️</button>
                                <button className="btn-icon btn-danger" onClick={() => handleDeleteRow(idx)}>🗑️</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-table">
                  <span className="empty-icon">📭</span>
                  <span>表为空</span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-db">
              <span className="empty-icon">🗂️</span>
              <p>选择左侧表查看数据</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DbManager