"""Regenerate non-sensitive PDF fixtures with reportlab and Pillow (test tooling only)."""
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageDraw, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

target = Path(__file__).with_name("document-matrix.pdf")
pdf = canvas.Canvas(str(target), pagesize=(600, 800), invariant=True)
pdf.setTitle("Synthetic document")
for page in range(1, 25):
    pdf.setPageSize((600, 800))
    pdf.setPageRotation(0)
    if page == 2:
        scan = Image.new("RGB", (600, 800), "white")
        draw = ImageDraw.Draw(scan)
        draw.rectangle((40, 100, 280, 300), fill="blue")
        draw.rectangle((320, 450, 560, 700), fill="red")
        pdf.drawImage(ImageReader(scan), 0, 0, width=600, height=800)
    elif page == 6:
        # Two scanned logical sheets on one landscape physical page.
        pdf.setPageSize((800, 600))
        scan = Image.new("RGB", (800, 600), (230, 230, 230))
        draw = ImageDraw.Draw(scan)
        draw.rectangle((20, 20, 380, 580), fill="white")
        draw.rectangle((420, 20, 780, 580), fill="white")
        draw.rectangle((100, 100, 300, 200), fill="blue")
        draw.rectangle((500, 400, 700, 500), fill="red")
        draw.text((70, 300), "Scanned sheet A", fill="black")
        draw.text((470, 300), "Scanned sheet B", fill="black")
        pdf.drawImage(ImageReader(scan), 0, 0, width=800, height=600)
    elif page in (7, 8):
        pdf.setPageSize((900, 600))
        pdf.setFont("Helvetica", 16)
        pdf.drawString(40, 550, "Rows 01-20" if page == 7 else "Rows 21-40")
        for x in (40, 245, 450, 655, 860):
            pdf.line(x, 100, x, 500)
        for row in range(22):
            y = 500 - row * (400 / 21)
            pdf.line(40, y, 860, y)
        pdf.setFont("Helvetica", 11)
        for x, heading in zip((50, 255, 460, 665), ("Item", "Mass (kg)", "Flow (m3/s)", "Adjustment (%)")):
            pdf.drawString(x, 486, heading)
        for row in range(20):
            y = 466 - row * (400 / 21)
            for x, value in zip((50, 255, 460, 665), (str(row + 1 + (page - 7) * 20), "123.45", "+0.250", "-7.25")):
                pdf.drawString(x, y, value)
        pdf.setFont("Helvetica", 4)
        pdf.drawString(40, 40, "Fine detail: -0.003 kg; x = 2 + 3; preserve units.")
    elif page == 9:
        # Low pixel count is intentional: enlargement cannot recover missing detail.
        scan = Image.new("RGB", (60, 80), "white")
        draw = ImageDraw.Draw(scan)
        draw.text((2, 2), "-0.003", fill="black")
        draw.rectangle((20, 30, 40, 50), fill=(180, 180, 180))
        scan = scan.filter(ImageFilter.GaussianBlur(0.5))
        pdf.drawImage(ImageReader(scan), 0, 0, width=600, height=800)
    else:
        pdf.setFont("Helvetica", 18)
        pdf.drawString(40, 750, f"Physical page {page}")
        if page == 3:
            pdf.setFillColorRGB(0, 0.7, 0)
            pdf.rect(300, 200, 200, 300, fill=True)
            pdf.setFillColorRGB(0, 0, 0)
        elif page == 4:
            pdf.setPageRotation(90)
            pdf.setFillColorRGB(1, 0, 0)
            pdf.rect(20, 20, 100, 100, fill=True)
            pdf.setFillColorRGB(0, 0, 1)
            pdf.rect(450, 450, 100, 100, fill=True)
            pdf.setFillColorRGB(0, 0, 0)
        elif page == 5:
            pdf.acroForm.textfield(name="saved", value="Saved value", x=40, y=600, width=200, height=30)
            pdf.textAnnotation("Saved annotation", Rect=(40, 400, 200, 450))
        else:
            pdf.setFont("Helvetica", 11)
            for row in range(35):
                pdf.drawString(40, 700 - row * 16, f"Row {row + 1:02d} | Item {page:02d} | 123.45 kg | +7.25")
            pdf.setFont("Helvetica", 4)
            pdf.drawString(40, 45, "Fine detail: -0.003 kg; x = 2 + 3; preserve units.")
    pdf.showPage()
pdf.save()
assert target.read_bytes().startswith(b"%PDF-")

# An operationally unsupported page between two valid pages, for partial batches.
limits = canvas.Canvas(str(target.with_name('document-limits.pdf')), invariant=True)
for size in [(300, 200), (15000, 200), (300, 200)]:
    limits.setPageSize(size)
    limits.drawString(20, 80, 'Synthetic page')
    limits.showPage()
limits.save()
