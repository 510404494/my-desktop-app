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
