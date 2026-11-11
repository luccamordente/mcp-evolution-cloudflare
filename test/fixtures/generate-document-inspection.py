"""Generate a non-sensitive fixture for bounded page-text/outline inspection."""
from pathlib import Path
from reportlab.pdfgen import canvas

pdf = canvas.Canvas(str(Path(__file__).with_name('document-inspection.pdf')), pagesize=(600, 800), invariant=True)
pdf.setTitle('Synthetic document')
pdf.addPageLabel(0, style='ROMAN_LOWER')
pdf.bookmarkPage('intro')
pdf.addOutlineEntry('Introduction', 'intro', level=0)
text = pdf.beginText(40, 750)
text.setFont('Helvetica', 8)
for row in range(90):
    text.textLine(f'Line {row:03d}: bounded extraction keeps the original text sequence and units 12.35 kg.')
pdf.drawText(text)
pdf.showPage()
pdf.addPageLabel(1, style='ARABIC', start=1)
pdf.bookmarkPage('mixed')
pdf.addOutlineEntry('Header and visual content', 'mixed', level=0)
pdf.drawString(40, 750, 'Header only')
pdf.setFillColorRGB(0.5, 0, 1)
pdf.rect(100, 100, 400, 400, fill=True)
pdf.showPage()
pdf.setFillColorRGB(0, 0, 0)
pdf.drawString(40, 100, 'Bottom drawn first')
pdf.drawString(40, 700, 'Top drawn later')
pdf.showPage()
pdf.save()

outline = canvas.Canvas(str(Path(__file__).with_name('document-outline.pdf')), pagesize=(600, 800), invariant=True)
outline.drawString(40, 750, 'Outline fixture')
for index in range(105):
    outline.bookmarkPage(f'entry-{index}')
    outline.addOutlineEntry(f'Entry {index:03d}', f'entry-{index}', level=0)
outline.showPage()
outline.save()
