declare module '@json-editor/json-editor' {
  interface JSONEditorOptions {
    schema: Record<string, unknown>
    startval?: Record<string, unknown>
    theme?: string
    iconlib?: string
    compact?: boolean
    [key: string]: unknown
  }

  export default class JSONEditor {
    constructor(element: HTMLElement, options: JSONEditorOptions)
    getValue(): Record<string, unknown>
    setValue(value: Record<string, unknown>): void
    on(event: string, callback: () => void): void
    off(event: string, callback: () => void): void
    destroy(): void
  }
}
