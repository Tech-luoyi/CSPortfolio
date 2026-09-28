export interface UploadProgress {
  loaded: number
  total: number
  percent: number
  bytesPerSecond: number
  remainingSeconds: number | null
}

export function postMultipartWithProgress<T>(
  url: string,
  body: FormData,
  onProgress: (progress: UploadProgress) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let previousLoaded = 0
    let previousAt = performance.now()
    xhr.open('POST', url)
    // Text response keeps error parsing portable across browsers; reading responseText
    // while responseType is 'json' throws InvalidStateError in several engines.
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const now = performance.now()
      const elapsed = Math.max(1, now - previousAt) / 1000
      const bytesPerSecond = Math.max(0, event.loaded - previousLoaded) / elapsed
      const remainingBytes = Math.max(0, event.total - event.loaded)
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round(event.loaded / event.total * 100)),
        bytesPerSecond,
        remainingSeconds: bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : null,
      })
      previousLoaded = event.loaded
      previousAt = now
    }
    xhr.onload = () => {
      let data: any = null
      if (xhr.responseText) {
        try { data = JSON.parse(xhr.responseText) } catch { data = null }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T)
        return
      }
      const message = data?.statusMessage || data?.message || `上传失败（HTTP ${xhr.status}）`
      reject(Object.assign(new Error(message), {
        status: xhr.status,
        statusCode: xhr.status,
        data: { statusCode: xhr.status, statusMessage: message, data },
      }))
    }
    xhr.onerror = () => reject(Object.assign(new Error('网络连接中断，请检查网络后重试'), { status: 0 }))
    xhr.onabort = () => reject(Object.assign(new Error('上传已取消'), { status: 0 }))
    xhr.send(body)
  })
}
