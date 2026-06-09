import { useState } from 'react'
import { Button, cn, formatDate } from '@workspace/ui'

function App() {
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [documentType, setDocumentType] = useState('')
	const [uploading, setUploading] = useState(false)
	const [uploadResult, setUploadResult] = useState<string>('')

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		console.log(file)
		if (file) {
			setSelectedFile(file)
		}
	}

	const handleUpload = async () => {
		if (!selectedFile || !documentType) {
			setUploadResult('Please select a file and document type')
			return
		}

		setUploading(true)
		setUploadResult('')

		const formData = new FormData()
		formData.append('file', selectedFile)
		formData.append('documentType', documentType)

		try {
			const response = await fetch('http://localhost:3001/upload', {
				method: 'POST',
				body: formData,
			})

			const result = await response.json()
			if (result.success) {
				setUploadResult(`Document uploaded successfully! ID: ${result.documentId}`)
				setSelectedFile(null)
				setDocumentType('')
			} else {
				setUploadResult(`Upload failed: ${result.error}`)
			}
		} catch (error) {
			setUploadResult('Upload failed: Network error')
		} finally {
			setUploading(false)
		}
	}

	return (
		<div className="min-h-screen bg-background p-8">
			<div className="max-w-4xl mx-auto space-y-8">
				<header className="text-center">
					<h1 className="text-4xl font-bold text-foreground mb-4">
						The Eye
					</h1>
					<p className="text-muted-foreground">
						Legal Document Processing Platform
					</p>
				</header>

				<main className="space-y-6">
					<section className="text-center">
						<h2 className="text-2xl font-semibold mb-4">Upload Document</h2>
						<div className="max-w-md mx-auto space-y-4">
							<div>
								<label className="block text-sm font-medium mb-2">Select File</label>
								<input
									type="file"
									accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.bmp,.svg"
									onChange={handleFileChange}
									className="w-full p-2 border rounded"
								/>
							</div>
							<div>
								<label className="block text-sm font-medium mb-2">Document Type</label>
								<select
									value={documentType}
									onChange={(e) => setDocumentType(e.target.value)}
									className="w-full p-2 border rounded"
								>
									<option value="">Select type...</option>
									<option value="judgment">Judgment</option>
									<option value="court_order">Court Order</option>
									<option value="contract">Contract</option>
									<option value="agreement">Agreement</option>
									<option value="police_report">Police Report</option>
									<option value="incident_report">Incident Report</option>
									<option value="witness_statement">Witness Statement</option>
									<option value="affidavit">Affidavit</option>
									<option value="pleading">Pleading</option>
									<option value="motion">Motion</option>
									<option value="brief">Brief</option>
									<option value="transcript">Transcript</option>
									<option value="administrative_decision">Administrative Decision</option>
									<option value="regulatory_filing">Regulatory Filing</option>
									<option value="other">Other</option>
								</select>
							</div>
							<Button
								onClick={handleUpload}
								disabled={!selectedFile || !documentType || uploading}
								className="w-full"
							>
								{uploading ? 'Uploading...' : 'Upload Document'}
							</Button>
							{uploadResult && (
								<p className={cn(
									"text-sm",
									uploadResult.includes('success') ? "text-green-600" : "text-red-600"
								)}>
									{uploadResult}
								</p>
							)}
						</div>
					</section>

					<section className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div className="p-6 border rounded-lg">
							<h3 className="font-semibold mb-2">API</h3>
							<p className="text-sm text-muted-foreground">
								Backend services running on port 3001
							</p>
						</div>
						<div className="p-6 border rounded-lg">
							<h3 className="font-semibold mb-2">Web</h3>
							<p className="text-sm text-muted-foreground">
								Frontend application with React
							</p>
						</div>
						<div className="p-6 border rounded-lg">
							<h3 className="font-semibold mb-2">Database</h3>
							<p className="text-sm text-muted-foreground">
								PostgreSQL with document storage
							</p>
						</div>
					</section>
				</main>
			</div>
		</div>
	)
}

export default App
