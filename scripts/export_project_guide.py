"""Export the project Markdown guide to a styled, editable Word document.

Install optional tooling: python -m pip install -r scripts/requirements-docs.txt
Run from any directory: python scripts/export_project_guide.py
"""
from pathlib import Path
import re
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'PROJECT_EXPLANATION.md'
TARGET = ROOT / 'docs' / 'PROJECT_EXPLANATION.docx'


def inline(paragraph, text):
    """Keep emphasis/code readable without leaving Markdown markers in Word."""
    parts = re.split(r'(\*\*.*?\*\*|`[^`]+`)', text)
    for part in parts:
        if not part:
            continue
        if part.startswith('**') and part.endswith('**'):
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        elif part.startswith('`') and part.endswith('`'):
            run = paragraph.add_run(part[1:-1])
            run.font.name = 'Consolas'
            run.font.size = Pt(9)
        else:
            paragraph.add_run(part)


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def add_table(document, lines):
    rows = [cells(line) for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r':?-+:?', cell) for cell in row)]
    table = document.add_table(rows=1, cols=len(rows[0]))
    table.style = 'Table Grid'
    table.autofit = False
    widths = [2.0, 4.65] if len(rows[0]) == 2 else [1.15, 1.8, 3.7]
    for index, text in enumerate(rows[0]):
        cell = table.rows[0].cells[index]
        cell.width = Inches(widths[index])
        inline(cell.paragraphs[0], text)
        shading = OxmlElement('w:shd')
        shading.set(qn('w:fill'), 'E4EFEB')
        cell._tc.get_or_add_tcPr().append(shading)
        for run in cell.paragraphs[0].runs:
            run.bold = True
            run.font.color.rgb = RGBColor.from_string('174C3B')
    repeat = OxmlElement('w:tblHeader')
    table.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in rows[1:]:
        output = table.add_row().cells
        for index, text in enumerate(row):
            output[index].width = Inches(widths[index])
            inline(output[index].paragraphs[0], text)
    for row in table.rows:
        no_split = OxmlElement('w:cantSplit')
        row._tr.get_or_add_trPr().append(no_split)
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(4)
                paragraph.paragraph_format.space_before = Pt(3)
                for run in paragraph.runs:
                    if run.font.name != 'Consolas':
                        run.font.size = Pt(9.5)
    document.add_paragraph()


def code_block(document, language, text):
    if language == 'mermaid':
        # Word readers get an accessible text flow instead of unrendered Mermaid DSL.
        for flow in (
            'Browser → Nginx gateway → Express API',
            'PostgreSQL/outbox → Redis/BullMQ → Node + Python worker',
            'MinIO output + PostgreSQL completion → previews and download',
        ):
            paragraph = document.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = paragraph.add_run(flow)
            run.bold = True
            run.font.color.rgb = RGBColor.from_string('17634B')
        document.add_paragraph('Prometheus and Grafana observe real API/queue statistics. The eight-module table above explains each role.')
        return
    paragraph = document.add_paragraph()
    paragraph.paragraph_format.keep_together = True
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), 'F2F5F4')
    paragraph._p.get_or_add_pPr().append(shading)
    run = paragraph.add_run(text.rstrip())
    run.font.name = 'Consolas'
    run.font.size = Pt(8.5)


def export():
    lines = SOURCE.read_text(encoding='utf-8').splitlines()
    document = Document()
    section = document.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.8)
    section.right_margin = Inches(0.8)
    section.header_distance = Inches(0.3)
    section.footer_distance = Inches(0.3)

    normal = document.styles['Normal']
    normal.font.name = 'Calibri'
    normal.font.size = Pt(11)
    normal.paragraph_format.line_spacing = 1.12
    normal.paragraph_format.space_after = Pt(7)
    for name in ('Heading 1', 'Heading 2', 'Heading 3'):
        document.styles[name].font.name = 'Calibri'
        document.styles[name].font.color.rgb = RGBColor.from_string('17553F')
        document.styles[name].paragraph_format.keep_with_next = True

    header = section.header.paragraphs[0]
    header.add_run('CLOUDFRAME  |  ADVANCED CLOUD COMPUTING').font.size = Pt(8)
    header.runs[0].font.color.rgb = RGBColor.from_string('6B7C75')
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    footer.add_run('CloudFrame · Page ').font.size = Pt(8)
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    footer._p.append(field)

    document.core_properties.title = 'Containerized Image Processing Service with Kubernetes Queue Workers'
    document.core_properties.subject = 'Detailed project introduction, technologies, workflow and cloud computing concepts'
    document.core_properties.author = 'CloudFrame Project Documentation'
    document.core_properties.keywords = 'Advanced Cloud Computing, Kubernetes, BullMQ, image processing'

    cover = document.add_paragraph(lines[0].removeprefix('# '), 'Title')
    cover.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cover.paragraph_format.space_before = Pt(90)
    for run in cover.runs:
        run.font.size = Pt(25)
        run.font.color.rgb = RGBColor.from_string('174C3B')
    subtitle = document.add_paragraph('CloudFrame — Detailed Project Explanation', 'Subtitle')
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    prepared = document.add_paragraph('Advanced Cloud Computing academic project\nImplementation guide · 26 October 2026')
    prepared.alignment = WD_ALIGN_PARAGRAPH.CENTER
    document.add_page_break()
    document.add_heading('Contents', level=1)
    for line in lines:
        if line.startswith('## '):
            document.add_paragraph(line[3:], style='List Bullet')
    document.add_page_break()

    index = next(index for index, line in enumerate(lines) if line.startswith('## '))
    while index < len(lines):
        line = lines[index]
        if not line.strip():
            index += 1
            continue
        if line.startswith('```'):
            language = line[3:].strip()
            index += 1
            block = []
            while index < len(lines) and not lines[index].startswith('```'):
                block.append(lines[index])
                index += 1
            code_block(document, language, '\n'.join(block))
            index += 1
            continue
        if line.startswith('|'):
            block = []
            while index < len(lines) and lines[index].startswith('|'):
                block.append(lines[index])
                index += 1
            add_table(document, block)
            continue
        if line.startswith('### '):
            document.add_heading(line[4:], level=2)
        elif line.startswith('## '):
            document.add_heading(line[3:], level=1)
        elif line.startswith('- '):
            inline(document.add_paragraph(style='List Bullet'), line[2:])
        elif re.match(r'^\d+\. ', line):
            inline(document.add_paragraph(style='List Number'), re.sub(r'^\d+\. ', '', line))
        else:
            paragraph_lines = [line]
            while index + 1 < len(lines) and lines[index + 1].strip() and not re.match(r'^(#|\||```|- |\d+\. )', lines[index + 1]):
                index += 1
                paragraph_lines.append(lines[index])
            inline(document.add_paragraph(), ' '.join(paragraph_lines))
        index += 1

    document.save(TARGET)
    loaded = Document(TARGET)
    headings = [paragraph.text for paragraph in loaded.paragraphs if paragraph.style.name == 'Heading 1']
    assert any(text == '1. Introduction' for text in headings)
    assert any(text == '6. Technologies and Tools in Detail' for text in headings)
    assert any(text == '8. Understanding the Limits and Monitoring Values' for text in headings)
    assert len(loaded.tables) >= 10
    assert not any('```' in paragraph.text for paragraph in loaded.paragraphs)
    print(f'Created {TARGET.name}: {len(headings)-1} main sections, {len(loaded.tables)} tables, {TARGET.stat().st_size:,} bytes')


if __name__ == '__main__':
    export()
