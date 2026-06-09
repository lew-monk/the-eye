import { extname } from 'path'

export function getFileExtension(filename: string): string {
	return extname(filename).toLowerCase().slice(1)
}

export function isSupportedFileType(filename: string): boolean {
	const supportedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'tif', 'bmp']
	const extension = getFileExtension(filename)
	return supportedTypes.includes(extension)
}

export function getMimeType(filename: string): string {
	const extension = getFileExtension(filename)
	const mimeTypes: Record<string, string> = {
		pdf: 'application/pdf',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		tiff: 'image/tiff',
		tif: 'image/tiff',
		bmp: 'image/bmp',
	}
	return mimeTypes[extension] || 'application/octet-stream'
}

export function validateFileSize(fileSize: number): boolean {
	const maxSize = 50 * 1024 * 1024 // 50MB
	return fileSize <= maxSize
}
