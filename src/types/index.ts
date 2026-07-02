export interface DeviceConfig {
  id: string
  name: string
  type: string
  filePath: string
  data: Record<string, unknown>
}

export interface DeviceCategory {
  name: string
  devices: DeviceConfig[]
}

export interface AppConfig {
  scanPaths: string[]
  lastOpenPath: string
}

export interface ServerConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
}

export interface ServerFile {
  name: string
  path: string
  size: number
  modified: string
  isDir: boolean
}
