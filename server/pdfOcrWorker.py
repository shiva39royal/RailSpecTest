import sys
import os
import json
import re
# Ensure user site-packages are reachable if invoked by an alternate Python interpreter
_user_site = os.path.expanduser(r"~\AppData\Local\Programs\Python\Python312\Lib\site-packages")
if os.path.exists(_user_site) and _user_site not in sys.path:
    sys.path.insert(0, _user_site)

try:
    import pymupdf  # type: ignore[import-untyped]
except ImportError:
    try:
        import fitz  # type: ignore[import-untyped]
        pymupdf = fitz
    except ImportError as e:
        raise ImportError(f"PyMuPDF is not installed in the active environment ({sys.executable}). Run: pip install pymupdf") from e

import pytesseract  # type: ignore[import-untyped]
from PIL import Image

_tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
if os.path.exists(_tesseract_path):
    pytesseract.pytesseract.tesseract_cmd = _tesseract_path

def clean_ocr_token(raw):
    if not raw:
        return ""
    s = re.sub(r'^[\[\(\{\|\\/\"\'`_=~,;.-]+', '', raw)
    s = re.sub(r'[\]\)\}\|\\/\"\'`_=~,;.-]+$', '', s)
    return s.strip()

def is_toc_document(doc):
    """Detect if the PDF is an explicit Table of Control / Station Configuration testing document (NOT a station layout drawing)."""
    for p in range(min(3, len(doc))):
        t = doc[p].get_text("text").upper()
        if not t.strip():
            pix = doc[p].get_pixmap(dpi=120)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            t = pytesseract.image_to_string(img).upper()
        # Explicit TOC title headers
        if 'TABLE OF CONTROL' in t or 'TOC NO' in t or 'STATION CONFIGURATION DATA TESTING' in t:
            return True
        # Explicit TOC multi-column combination headers (never single keywords)
        if ('ENTRY SIGNAL' in t and 'MOVEMENT AUTHORITY' in t) or ('CHECK RFID SEQUENCE' in t and 'TINS REQUIRES' in t):
            return True
    return False

def extract_toc_metadata(doc):
    full_text = ""
    for p in range(min(4, len(doc))):
        t = doc[p].get_text("text")
        if not t.strip():
            pix = doc[p].get_pixmap(dpi=150)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            t = pytesseract.image_to_string(img)
        full_text += "\n" + t

    meta = {}
    
    # Station Name
    m_name = re.search(r'Station\s*Name\s*[:\-]?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if m_name:
        clean = m_name.group(1).split('Division')[0].strip('|_ ')
        meta['stationName'] = clean

    # Station ID
    m_id = re.search(r'Station\s*ID\s*[:\-]?\s*(\d{2,6})', full_text, re.IGNORECASE)
    if m_id:
        meta['stationId'] = m_id.group(1).strip()

    # Division
    m_div = re.search(r'Division\s*[:\-]?\s*([A-Za-z\s]+)', full_text, re.IGNORECASE)
    if m_div:
        meta['division'] = m_div.group(1).split('\n')[0].strip('|_ ')

    # Section
    m_sec = re.search(r'Section\s*[:\-]?\s*([A-Za-z0-9\s]+)', full_text, re.IGNORECASE)
    if m_sec:
        meta['section'] = m_sec.group(1).split('\n')[0].strip('|_ ')

    # SIP Ref
    m_sip = re.search(r'REF\.?\s*SIP\.?\s*NO\.?\s*[:\-]?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if m_sip:
        meta['sipRef'] = m_sip.group(1).strip('|_ ')

    # TOC Ref
    m_toc = re.search(r'REF\.?\s*(?:TOC|TABLE\s*OF\s*CONTROL)\.?\s*NO\.?\s*[:\-]?\s*([^\n\r]+)', full_text, re.IGNORECASE)
    if m_toc:
        meta['tocRef'] = m_toc.group(1).strip('|_ ')

    return meta

def derive_ma_from_exit(exit_asp):
    norm = str(exit_asp or '').strip().lower()
    if 'green' in norm:
        return '4'
    if 'double yellow' in norm:
        return '3'
    if 'yellow' in norm:
        return '2'
    return '1'

def normalize_toc_points(raw_val):
    if not raw_val or str(raw_val).strip() in ['-', '', 'Nil', 'NIL', 'None', 'NONE']:
        return '-'
    cleaned_str = str(raw_val).strip()
    cleaned_str = re.sub(r'\b(?:POINT|PT|P)\s+(\d+[A-Za-z0-9]*)', r'P-\1', cleaned_str, flags=re.IGNORECASE)
    cleaned_str = re.sub(r'(\d+[A-Za-z0-9]*)\s+(?:POINT|PT)\b', r'P-\1', cleaned_str, flags=re.IGNORECASE)

    tokens = re.split(r'[,;\s/]+', cleaned_str)
    normalized = []
    seen = set()
    for tok in tokens:
        tok_clean = tok.strip().upper()
        if not tok_clean or tok_clean == '-' or tok_clean in ['NIL', 'NONE', 'POINT', 'PT']:
            continue
        m_p = re.match(r'^P[-_]?([A-Z0-9]+)$', tok_clean)
        if m_p:
            p_label = f"P-{m_p.group(1)}"
        elif re.match(r'^(?:PT|POINT)[-_]?([A-Z0-9]+)$', tok_clean):
            m_pt = re.match(r'^(?:PT|POINT)[-_]?([A-Z0-9]+)$', tok_clean)
            p_label = f"P-{m_pt.group(1)}"
        elif re.match(r'^[I|]?N[-_]?([A-Z0-9]+)$', tok_clean):
            m_n = re.match(r'^[I|]?N[-_]?([A-Z0-9]+)$', tok_clean)
            p_label = f"P-{m_n.group(1)}"
        elif re.match(r'^([0-9]+[A-Z0-9]*)$', tok_clean):
            p_label = f"P-{tok_clean}"
        else:
            p_label = f"P-{tok_clean}" if not tok_clean.startswith('P-') else tok_clean
            
        if p_label not in seen:
            seen.add(p_label)
            normalized.append(p_label)
    
    return ", ".join(normalized) if normalized else '-'

def extract_toc_tables(doc):
    """Extract structured Table 1, Table 2, Table 4, Table 6, Table 7 from TOC document."""
    tables = {
        "table1_control": [],
        "table2_block_section": [],
        "table3_shunting_limit": [],
        "table4_track_profile": [],
        "table5_tsr_route": [],
        "table6_tsl_control": [],
        "table7_tsl_track_profile": []
    }

    t1_sno = 1
    t4_sno = 1
    t7_sno = 1

    for page_idx, page in enumerate(doc):
        # Check if native tables exist
        tab_finder = page.find_tables()
        if tab_finder.tables:
            for tab in tab_finder.tables:
                # Extract cleanly per cell bbox to avoid multi-line character interleaving
                extracted = []
                for r in tab.rows:
                    row_vals = []
                    for cell_bbox in r.cells:
                        if cell_bbox is not None:
                            txt = page.get_text('text', clip=cell_bbox).strip()
                        else:
                            txt = ""
                        row_vals.append(txt)
                    extracted.append(row_vals)
                if not extracted or len(extracted) < 2:
                    continue
                header_row = " ".join([str(c or '').replace('\n', ' ') for c in extracted[0]]).upper()
                
                # Table 1: Entry Signal, Exit Signal, Line, Signal Type...
                if 'ENTRY' in header_row and 'EXIT' in header_row and 'ASPECT' in header_row and 'TSL' not in header_row:
                    current_entry = ""
                    current_exit = ""
                    current_line = ""
                    current_sigtype = ""
                    current_foot_tag = ""
                    current_en_route = ""
                    current_dist = ""
                    current_sr = "MPS"
                    current_os = "15"
                    current_pts_n = ""
                    current_pts_r = ""
                    current_tc = ""
                    current_tin = ""

                    for r in extracted[2:]:
                        cleaned = [str(c or '').replace('\n', ' ').strip() for c in r]
                        if not any(cleaned):
                            continue
                        
                        # Check if this row starts a new signal route
                        if cleaned[0] and (re.match(r'^(S|SH|C|GS)?\d{1,3}[A-Z]*$', cleaned[0]) or len(cleaned[0]) <= 8):
                            current_entry = cleaned[0]
                            current_exit = cleaned[1] if len(cleaned) > 1 and cleaned[1] else ""
                            current_line = cleaned[2] if len(cleaned) > 2 and cleaned[2] else ""
                            current_sigtype = cleaned[4] if len(cleaned) > 4 and cleaned[4] else ""
                            current_pts_n = normalize_toc_points(cleaned[8]) if len(cleaned) > 8 and cleaned[8] else ""
                            current_pts_r = normalize_toc_points(cleaned[9]) if len(cleaned) > 9 and cleaned[9] else ""
                            current_tc = cleaned[10] if len(cleaned) > 10 and cleaned[10] else ""
                            current_tin = cleaned[11] if len(cleaned) > 11 and cleaned[11] else ""
                            current_foot_tag = cleaned[12] if len(cleaned) > 12 and cleaned[12] else ""
                            current_en_route = cleaned[13] if len(cleaned) > 13 and cleaned[13] else ""
                            current_dist = cleaned[14] if len(cleaned) > 14 and cleaned[14] else ""
                            current_sr = cleaned[16] if len(cleaned) > 16 and cleaned[16] else ""
                            current_os = cleaned[17] if len(cleaned) > 17 and cleaned[17] else ""
                        else:
                            # Update route properties if present on aspect row
                            if len(cleaned) > 1 and cleaned[1]: current_exit = cleaned[1]
                            if len(cleaned) > 2 and cleaned[2]: current_line = cleaned[2]
                            if len(cleaned) > 12 and cleaned[12]: current_foot_tag = cleaned[12]
                            if len(cleaned) > 13 and cleaned[13]: current_en_route = cleaned[13]
                            if len(cleaned) > 14 and cleaned[14]: current_dist = cleaned[14]

                        if not current_entry:
                            continue

                        aspect_entry = cleaned[5] if len(cleaned) > 5 and cleaned[5] else ""
                        aspect_exit = cleaned[6] if len(cleaned) > 6 and cleaned[6] else ""
                        foot_tag = cleaned[12] if len(cleaned) > 12 and cleaned[12] else current_foot_tag
                        en_route = cleaned[13] if len(cleaned) > 13 and cleaned[13] else (current_en_route if current_en_route else "-")
                        dist = cleaned[14] if len(cleaned) > 14 and cleaned[14] else current_dist
                        ma = cleaned[15] if len(cleaned) > 15 and cleaned[15] else "1"

                        section_type = "Absolute Block" if ("DIST" in current_sigtype.upper() or "ADV" in current_sigtype.upper()) else "Station Section"
                        is_calling_on = bool(re.search(r'calling', current_sigtype, re.IGNORECASE) or current_entry.upper().endswith('A'))
                        is_block = section_type == "Absolute Block"

                        tc_up_val = current_tc.replace('\n', ' ').strip() if current_tc else "-"
                        if is_calling_on and tc_up_val != "-" and "OCCUPIED" not in tc_up_val.upper():
                            tc_up_val = f"{tc_up_val} (Occupied)"

                        tins_free_val = "-"
                        if not is_calling_on and not is_block and current_tin:
                            raw_tin_tokens = re.split(r'[,;\s]+', current_tin.replace('\n', ' ').strip())
                            norm_tins = []
                            seen_tin = set()
                            for tok in raw_tin_tokens:
                                tok_clean = tok.strip().upper()
                                if not tok_clean or tok_clean == '-':
                                    continue
                                if re.match(r'^N\d+', tok_clean):
                                    tok_clean = f"N-{tok_clean[1:]}"
                                elif re.match(r'^TIN\d+', tok_clean):
                                    tok_clean = f"TIN-{tok_clean[3:]}"
                                if tok_clean not in seen_tin:
                                    seen_tin.add(tok_clean)
                                    norm_tins.append(tok_clean)
                            tins_free_val = ", ".join(norm_tins) if norm_tins else "-"
                        
                        exit_parts = [p.strip() for p in aspect_exit.split('/') if p.strip()] if '/' in aspect_exit else [aspect_exit]
                        for exp_exit in exit_parts:
                            calc_ma = derive_ma_from_exit(exp_exit)
                            tables["table1_control"].append({
                                "rowId": f"t1_toc_{len(tables['table1_control'])+1}",
                                "cells": {
                                    "sNo": str(t1_sno),
                                    "entrySignal": current_entry,
                                    "exitSignal": current_exit,
                                    "sectionType": section_type,
                                    "line": current_line,
                                    "signalType": current_sigtype,
                                    "aspectEntry": aspect_entry,
                                    "aspectExit": exp_exit,
                                    "pointsNormal": normalize_toc_points(current_pts_n),
                                    "pointsReverse": normalize_toc_points(current_pts_r),
                                    "trackCircuitUp": tc_up_val,
                                    "tinsFree": tins_free_val,
                                    "tinsOverlap": "-",
                                    "entryFootTag": foot_tag,
                                    "enRouteTags": en_route,
                                    "distanceMeters": dist,
                                    "movementAuthority": calc_ma,
                                    "authorizedSpeedOs": current_os
                                },
                                "cellMeta": {},
                                "sourceTrace": f"Extracted from Table of Control Page {page_idx+1}"
                            })
                            t1_sno += 1

                # Table 2: Block Section Details
                elif 'BLOCK' in header_row and ('SECTION' in header_row or 'LSS' in header_row):
                    for r in extracted[2:]:
                        cleaned = [str(c or '').replace('\n', ' ').strip() for c in r]
                        if not any(cleaned) or not cleaned[0] or cleaned[0] == '----':
                            continue
                        tables["table2_block_section"].append({
                            "rowId": f"t2_toc_{len(tables['table2_block_section'])+1}",
                            "cells": {
                                "lssSignal": cleaned[0],
                                "distanceMeters": "",
                                "blockSectionTin": cleaned[1] if len(cleaned) > 1 else "-",
                                "movementDirection": "UP" if "UP" in str(cleaned) else "Down",
                                "adjacentLineTins": cleaned[2] if len(cleaned) > 2 else "-",
                                "nextStationId": cleaned[3] if len(cleaned) > 3 else "",
                                "nextStationBorderRfid": cleaned[4] if len(cleaned) > 4 else "-",
                                "authorizedSpeed": "MPS",
                                "startDistAbsReset": cleaned[5] if len(cleaned) > 5 else "-",
                                "absLocationCorrection": cleaned[6] if len(cleaned) > 6 else "-",
                                "locoDirectionAfterAdj": cleaned[7] if len(cleaned) > 7 else "Nominal"
                            },
                            "cellMeta": {},
                            "sourceTrace": f"Extracted from Table of Control Page {page_idx+1}"
                        })

                # Table 4: Track Profile Table
                elif 'TURNOUT' in header_row and 'GRADIENT' in header_row and 'TSL' not in header_row:
                    for r in extracted[2:]:
                        cleaned = [str(c or '').replace('\n', ' ').strip() for c in r]
                        if not any(cleaned) or not cleaned[0]:
                            continue
                        sig_match = re.match(r'^(S|SH|C|GS)?\d{1,3}[A-Z]*$', cleaned[0])
                        if sig_match:
                            tables["table4_track_profile"].append({
                                "rowId": f"t4_toc_{len(tables['table4_track_profile'])+1}",
                                "cells": {
                                    "sNo": str(t4_sno),
                                    "entrySignal": cleaned[0],
                                    "exitSignal": cleaned[1] if len(cleaned) > 1 else "",
                                    "line": cleaned[2] if len(cleaned) > 2 else "",
                                    "turnoutSpeedKmph": cleaned[3] if len(cleaned) > 3 else "-",
                                    "turnoutStartDist": cleaned[4] if len(cleaned) > 4 else "-",
                                    "turnoutLength": cleaned[5] if len(cleaned) > 5 else "-",
                                    "psrTuples": cleaned[6] if len(cleaned) > 6 else "",
                                    "engineeringGradient": cleaned[7] if len(cleaned) > 7 else "",
                                    "averageGradient": cleaned[7] if len(cleaned) > 7 else "",
                                    "gradientLength": cleaned[8] if len(cleaned) > 8 else "",
                                    "lcDistance": cleaned[9] if len(cleaned) > 9 else "-",
                                    "lcId": "-",
                                    "lcManningType": "-",
                                    "lcClass": "-",
                                    "lcAutoWhistling": "-",
                                    "trackConditionType": "-",
                                    "trackConditionStart": "-",
                                    "trackConditionLength": "-"
                                },
                                "cellMeta": {},
                                "sourceTrace": f"Extracted from Table of Control Page {page_idx+1}"
                            })
                            t4_sno += 1

                # Table 7: TSL Track Profile (check before Table 6 because both contain TSL Entry)
                elif 'TSL' in header_row and ('TURNOUT' in header_row or 'GRADIENT' in header_row):
                    for r in extracted[2:]:
                        cleaned = [str(c or '').replace('\n', ' ').strip() for c in r]
                        if not any(cleaned) or not cleaned[0]:
                            continue
                        sig_match = re.match(r'^(S|SH|C|GS)?\d{1,3}[A-Z]*$', cleaned[0])
                        if sig_match:
                            tables["table7_tsl_track_profile"].append({
                                "rowId": f"t7_toc_{len(tables['table7_tsl_track_profile'])+1}",
                                "cells": {
                                    "sNo": str(t7_sno),
                                    "tslEntrySignal": cleaned[0],
                                    "tslExitSignal": cleaned[1] if len(cleaned) > 1 else cleaned[0],
                                    "turnoutSpeedKmph": cleaned[2] if len(cleaned) > 2 else "30",
                                    "turnoutStartDist": cleaned[3] if len(cleaned) > 3 else "0",
                                    "turnoutLength": cleaned[4] if len(cleaned) > 4 else "",
                                    "psrTuples": cleaned[5] if len(cleaned) > 5 else "",
                                    "engineeringGradient": cleaned[6] if len(cleaned) > 6 else "",
                                    "averageGradient": cleaned[6] if len(cleaned) > 6 else "",
                                    "gradientLength": cleaned[7] if len(cleaned) > 7 else "",
                                    "lcDistance": "-",
                                    "lcId": "-",
                                    "lcManningType": "-",
                                    "lcClass": "-",
                                    "lcAutoWhistling": "-",
                                    "trackConditionType": "-",
                                    "trackConditionStart": "-",
                                    "trackConditionLength": "-"
                                },
                                "cellMeta": {},
                                "sourceTrace": f"Extracted from Table of Control Page {page_idx+1}"
                            })
                            t7_sno += 1

                # Table 6: Temporary Single Line (TSL) Working Control Table
                elif 'TSL' in header_row and ('ENTRY' in header_row or 'STARTER' in header_row):
                    for r in extracted[2:]:
                        cleaned = [str(c or '').replace('\n', ' ').strip() for c in r]
                        if not any(cleaned) or not cleaned[0]:
                            continue
                        sig_match = re.match(r'^(S|SH|C|GS)?\d{1,3}[A-Z]*$', cleaned[0])
                        if sig_match:
                            tables["table6_tsl_control"].append({
                                "rowId": f"t6_toc_{len(tables['table6_tsl_control'])+1}",
                                "cells": {
                                    "tslEntrySignal": cleaned[0],
                                    "tslExitSignal": cleaned[1] if len(cleaned) > 1 else "",
                                    "signalType": cleaned[2] if len(cleaned) > 2 else "",
                                    "aspectEntry": cleaned[3] if len(cleaned) > 3 else "Red/Blank",
                                    "aspectExit": cleaned[4] if len(cleaned) > 4 else "Red",
                                    "requiredRouteCommand": cleaned[5] if len(cleaned) > 5 else "",
                                    "pointsNormal": normalize_toc_points(cleaned[6]) if (len(cleaned) > 6 and cleaned[6]) else "-",
                                    "pointsReverse": normalize_toc_points(cleaned[7]) if (len(cleaned) > 7 and cleaned[7]) else "-",
                                    "trackCircuitUp": cleaned[8] if len(cleaned) > 8 else "",
                                    "tinsFree": cleaned[9] if (len(cleaned) > 9 and cleaned[9]) else "-",
                                    "entryFootTag": cleaned[10] if len(cleaned) > 10 else "",
                                    "enRouteTags": cleaned[11] if (len(cleaned) > 11 and cleaned[11]) else "-",
                                    "distanceMeters": cleaned[12] if len(cleaned) > 12 else "",
                                    "movementAuthority": cleaned[13] if len(cleaned) > 13 else "1",
                                    "authorizedSpeedOs": cleaned[14] if len(cleaned) > 14 else "15"
                                },
                                "cellMeta": {},
                                "sourceTrace": f"Extracted from Table of Control Page {page_idx+1}"
                            })

    # If no vector tables found (e.g. scanned TOC), extract via OCR line clustering
    if len(tables["table1_control"]) == 0:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            pix = page.get_pixmap(dpi=200)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            txt = pytesseract.image_to_string(img)
            lines = [l.strip() for l in txt.split('\n') if l.strip()]
            for line in lines:
                cleaned = re.sub(r'^[|\[\(\{"\'\-_]+', '', line).strip()
                # Clean OCR artifacts where S is read as $ or 8 before digits
                cleaned_tokens = []
                for tok in cleaned.split():
                    if re.match(r'^[$8]\d{1,3}[A-Z]*$', tok):
                        cleaned_tokens.append(f"S{tok[1:]}")
                    else:
                        cleaned_tokens.append(tok)
                cleaned_line = " ".join(cleaned_tokens)

                m = re.match(r'^(\d{1,3})\s*[|/]?\s*([S|C|G|s|c|g]?\d{1,3}[A-Za-z0-9/_-]*)\s*[|/]?\s*([S|C|G|s|c|g]?\d{1,3}[A-Za-z0-9/_-]*|HOME)?\s*[|/]?\s*(MAIN|LOOP|BRANCH|\(MAIN\)|\(LOOP\))?', cleaned_line, re.IGNORECASE)
                if m:
                    sno = m.group(1)
                    entry = m.group(2).upper()
                    exit_sig = (m.group(3) or '').upper()
                    line_name = m.group(4) or 'MAIN'
                    if len(entry) <= 8 and not re.match(r'^(?:19\d\d|20\d\d|ALT|REF|SIP|TOC|DRG)', entry, re.IGNORECASE):
                        if not entry.startswith('S') and not entry.startswith('SH') and not entry.startswith('C') and not entry.startswith('GS'):
                            entry = f"S{entry}"
                        if exit_sig and not exit_sig.startswith('S') and not exit_sig.startswith('SH') and not exit_sig.startswith('C') and not exit_sig.startswith('GS') and exit_sig != 'HOME':
                            exit_sig = f"S{exit_sig}"
                        if not exit_sig:
                            if "D" in entry:
                                exit_sig = "HOME"
                            else:
                                exit_sig = "-"

                        # Extract RFID tags and distances from the text line
                        tag_matches = re.findall(r'R-?\d{2,4}[A-Z]?', line, re.IGNORECASE)
                        foot_tag = f"R-{tag_matches[0].upper().replace('R-', '').replace('R', '')}" if tag_matches else ""

                        dist_matches = [int(n) for n in re.findall(r'\b\d{3,5}\b', line) if 100 <= int(n) <= 6000]
                        dist_val = str(dist_matches[0]) if dist_matches else ("1000" if "D" in entry else "600")

                        if len(tag_matches) > 1:
                            en_tags = [f"R-{t.upper().replace('R-', '').replace('R', '')}" for t in tag_matches[1:]]
                            per_dist = int(dist_val) // len(en_tags)
                            en_route = ", ".join([f"({per_dist}, {t})" for t in en_tags])
                        else:
                            en_route = "-"

                        sec_type = "Absolute Block" if ("DIST" in entry or "ADV" in entry or "D" in entry) else "Station Section"
                        tables["table1_control"].append({
                            "rowId": f"t1_scanned_toc_{len(tables['table1_control'])+1}",
                            "cells": {
                                "sNo": str(t1_sno),
                                "entrySignal": entry,
                                "exitSignal": exit_sig if exit_sig else "HOME",
                                "sectionType": sec_type,
                                "line": line_name.strip('()'),
                                "signalType": "Home" if "HOME" in exit_sig else ("Starter" if "LOOP" in line_name else "Main"),
                                "aspectEntry": "Yellow",
                                "aspectExit": "Red" if exit_sig else "",
                                "pointsNormal": "-",
                                "pointsReverse": "-",
                                "trackCircuitUp": "",
                                "tinsFree": "-",
                                "tinsOverlap": "-",
                                "entryFootTag": foot_tag,
                                "enRouteTags": en_route,
                                "distanceMeters": dist_val,
                                "movementAuthority": "1",
                                "authorizedSpeedOs": "15"
                            },
                            "cellMeta": {},
                            "sourceTrace": f"Extracted from Scanned Table of Control Page {page_idx+1}"
                        })
                        t1_sno += 1

    return tables

def process_pdf(pdf_path, page_num=1):
    doc = pymupdf.open(pdf_path)
    page_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[page_idx]
    
    page_rect = page.rect
    page_w = page_rect.width
    page_h = page_rect.height

    # Check if this PDF is a Table of Control (TOC) companion sheet
    is_toc = is_toc_document(doc)
    toc_meta = extract_toc_metadata(doc) if is_toc else {}
    toc_tables = extract_toc_tables(doc) if is_toc else {}

    # Check for native vector drawings to find tight ink bounding box
    drawings = page.get_drawings()
    vector_path_count = len(drawings)
    
    if drawings:
        ink_x0 = min(d['rect'].x0 for d in drawings)
        ink_y0 = min(d['rect'].y0 for d in drawings)
        ink_x1 = max(d['rect'].x1 for d in drawings)
        ink_y1 = max(d['rect'].y1 for d in drawings)
    else:
        ink_x0, ink_y0, ink_x1, ink_y1 = 0.0, 0.0, page_w, page_h

    # Small padding around ink bounds
    pad_x = max(5.0, (ink_x1 - ink_x0) * 0.01)
    pad_y = max(5.0, (ink_y1 - ink_y0) * 0.01)
    clip_rect = pymupdf.Rect(
        max(0.0, ink_x0 - pad_x),
        max(0.0, ink_y0 - pad_y),
        min(page_w, ink_x1 + pad_x),
        min(page_h, ink_y1 + pad_y)
    )

    clip_w = clip_rect.width
    clip_h = clip_rect.height

    # Check native text
    native_words = page.get_text("words")
    non_trivial_native = [w for w in native_words if len(w[4].strip()) > 1]
    
    text_annotations = []
    entities = []
    seq = 1

    # If native words are plentiful (> 30 non-trivial words), use native text
    if len(non_trivial_native) >= 30:
        for w in native_words:
            word = w[4].strip()
            if not word:
                continue
            x_pt = round((w[0] + w[2]) / 2, 2)
            y_pt = round(page_h - (w[1] + w[3]) / 2, 2) # Y-up
            h_pt = round(abs(w[3] - w[1]), 2)
            tid = f"pdf_txt_{seq}"
            text_annotations.append({
                "id": tid,
                "text": word,
                "x": x_pt,
                "y": y_pt,
                "height": max(1.0, h_pt),
                "layer": "PDF_TEXT"
            })
            entities.append({
                "id": tid,
                "type": "TEXT",
                "layer": "PDF_TEXT",
                "color": "#0f172a",
                "center": {"x": x_pt, "y": y_pt},
                "text": word,
                "height": max(1.0, h_pt)
            })
            seq += 1
    else:
        # OCR needed
        # Auto-detect optimal orientation: test 0, 90, 270 rotations
        rot_candidates = [0]
        if page_h > page_w * 1.3 or clip_h > clip_w * 1.3:
            rot_candidates = [0, 90, 270]

        best_rot = 0
        best_score = -1

        for rot in rot_candidates:
            page.set_rotation(rot)
            # Low DPI preview for fast score
            pix = page.get_pixmap(clip=None if rot in (90, 270) else clip_rect, dpi=120)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            txt = pytesseract.image_to_string(img)
            score = 0
            for kw in ['STATION', 'SIGNAL', 'RFID', 'NOMINAL', 'REVERSE', 'MAIN', 'LOOP', 'LINE', 'BUILDING', 'UP', 'DOWN', 'TIN', 'GATE', 'CROSSING', 'TURNOUT', 'TRACK', 'BERTH', 'PLATFORM']:
                if kw in txt.upper():
                    score += 5
            score += len(re.findall(r'R-?\d{2,4}', txt)) * 4
            score += len(re.findall(r'S-?\d{1,3}', txt)) * 4
            score += len(re.findall(r'N-?\d{1,3}', txt)) * 3
            if score > best_score:
                best_score = score
                best_rot = rot

        # Render at high DPI with best rotation
        page.set_rotation(best_rot)
        rot_page_rect = page.rect
        is_rot = best_rot in (90, 270)

        # Build OCR tile list: for wide strip layouts (like railway SIP/RFID plans),
        # tile horizontally into overlapping ~550-650 DPI crops with --psm 11 so tiny 3pt SHX text
        # is 25-35px tall and never misread (e.g. N-46 vs P-46, or random noise as '7').
        ocr_tiles = []
        if not is_rot and (clip_h < 350 or clip_w > clip_h * 2.2):
            num_tiles = max(4, min(6, int(round(clip_w / max(clip_h * 1.1, 120.0)))))
            tile_w = clip_w / num_tiles
            overlap = tile_w * 0.12
            target_scale = min(8.0, max(5.0, 2200.0 / max(clip_h, 1.0)))
            for ti in range(num_tiles):
                tx0 = max(clip_rect.x0, clip_rect.x0 + ti * tile_w - (overlap if ti > 0 else 0.0))
                tx1 = min(clip_rect.x1, clip_rect.x0 + (ti + 1) * tile_w + (overlap if ti < num_tiles - 1 else 0.0))
                t_rect = pymupdf.Rect(tx0, clip_rect.y0, tx1, clip_rect.y1)
                ocr_tiles.append((t_rect, target_scale, '--psm 11'))
        else:
            dpi = 200 if (rot_page_rect.width > 4000 or rot_page_rect.height > 4000) else 250
            ocr_tiles.append((None if is_rot else clip_rect, dpi / 72.0, ''))

        seen_ocr_pts = []
        for tile_rect, tile_scale, tess_cfg in ocr_tiles:
            if tile_rect is None:
                pix = page.get_pixmap(matrix=pytesseract and pymupdf.Matrix(tile_scale, tile_scale))
                t_x0, t_y0 = 0.0, 0.0
                t_w, t_h = rot_page_rect.width, rot_page_rect.height
            else:
                pix = page.get_pixmap(clip=tile_rect, matrix=pymupdf.Matrix(tile_scale, tile_scale))
                t_x0, t_y0 = tile_rect.x0, tile_rect.y0
                t_w, t_h = max(1.0, tile_rect.width), max(1.0, tile_rect.height)

            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            ocr_data = pytesseract.image_to_data(img, config=tess_cfg, output_type=pytesseract.Output.DICT)
            n_items = len(ocr_data['text'])
            scale_x = pix.width / t_w
            scale_y = pix.height / t_h

            for i in range(n_items):
                raw_word = ocr_data['text'][i].strip()
                conf = int(ocr_data['conf'][i])
                if not raw_word:
                    continue

                clean_word = clean_ocr_token(raw_word)
                if not clean_word:
                    continue

                # Strict noise filter: reject low-confidence tokens and low-conf bare 1-2 digit specks
                if conf < 20:
                    continue
                if re.match(r'^\d{1,2}$', clean_word) and conf < 30:
                    continue

                px, py, pw, ph = ocr_data['left'][i], ocr_data['top'][i], ocr_data['width'][i], ocr_data['height'][i]

                if is_rot:
                    pt_x = (px + pw / 2) / scale_x
                    pt_y = rot_page_rect.height - (py + ph / 2) / scale_y
                    pt_h = ph / scale_y
                else:
                    pt_x = t_x0 + (px + pw / 2) / scale_x
                    pt_y = page_h - (t_y0 + (py + ph / 2) / scale_y)
                    pt_h = ph / scale_y

                # Deduplicate words across overlapping horizontal tiles
                dup = False
                for (sx, sy, st) in seen_ocr_pts:
                    if st == clean_word and abs(sx - pt_x) < 6.0 and abs(sy - pt_y) < 6.0:
                        dup = True
                        break
                if dup:
                    continue
                seen_ocr_pts.append((pt_x, pt_y, clean_word))

                tid = f"ocr_txt_{seq}"
                text_annotations.append({
                    "id": tid,
                    "text": clean_word,
                    "x": round(pt_x, 2),
                    "y": round(pt_y, 2),
                    "height": max(1.0, round(pt_h, 2)),
                    "layer": "OCR_TEXT",
                    "confidence": conf
                })
                entities.append({
                    "id": tid,
                    "type": "TEXT",
                    "layer": "OCR_TEXT",
                    "color": "#0f172a",
                    "center": {"x": round(pt_x, 2), "y": round(pt_y, 2)},
                    "text": clean_word,
                    "height": max(1.0, round(pt_h, 2))
                })
                seq += 1

    # Extract vector geometry entities from drawings if present
    circles = []
    lines = []
    for d in drawings:
        r = d.get('rect')
        color = '#0f172a'
        if d.get('color'):
            c = d['color']
            color = f"#{int(c[0]*255):02x}{int(c[1]*255):02x}{int(c[2]*255):02x}"
        
        w = r.width
        h = r.height
        cx = (r.x0 + r.x1) / 2
        cy = page_h - (r.y0 + r.y1) / 2
        rad = (w + h) / 4
        
        if 2.0 <= rad <= 40.0 and abs(w - h) < 3.0:
            cid = f"circle_{len(circles)+1}"
            circles.append({
                "id": cid,
                "x": round(cx, 2),
                "y": round(cy, 2),
                "r": round(rad, 2),
                "layer": "PDF_VECTOR",
                "color": color
            })
            entities.append({
                "id": cid,
                "type": "CIRCLE",
                "layer": "PDF_VECTOR",
                "color": color,
                "center": {"x": round(cx, 2), "y": round(cy, 2)},
                "radius": round(rad, 2)
            })
        elif (w > 10.0 or h > 10.0) and (w < 4.0 or h < 4.0):
            lid = f"line_{len(lines)+1}"
            lines.append({
                "id": lid,
                "x1": round(r.x0, 2),
                "y1": round(page_h - r.y0, 2),
                "x2": round(r.x1, 2),
                "y2": round(page_h - r.y1, 2),
                "layer": "PDF_VECTOR",
                "color": color
            })
            entities.append({
                "id": lid,
                "type": "LINE",
                "layer": "PDF_VECTOR",
                "color": color,
                "start": {"x": round(r.x0, 2), "y": round(page_h - r.y0, 2)},
                "end": {"x": round(r.x1, 2), "y": round(page_h - r.y1, 2)}
            })

    output_w = rot_page_rect.width if ('is_rot' in locals() and is_rot) else page_w
    output_h = rot_page_rect.height if ('is_rot' in locals() and is_rot) else page_h

    result = {
        "textCount": len(text_annotations),
        "vectorPathCount": vector_path_count,
        "isToc": is_toc,
        "tocMetadata": toc_meta,
        "tocTables": toc_tables,
        "bounds": {
            "pageNumber": page_idx + 1,
            "pageWidth": output_w,
            "pageHeight": output_h,
            "llx": 0.0,
            "lly": 0.0,
            "urx": output_w,
            "ury": output_h,
            "cropX": clip_rect.x0 if not ('is_rot' in locals() and is_rot) else 0.0,
            "cropY": clip_rect.y0 if not ('is_rot' in locals() and is_rot) else 0.0,
            "cropWidth": clip_w if not ('is_rot' in locals() and is_rot) else output_w,
            "cropHeight": clip_h if not ('is_rot' in locals() and is_rot) else output_h,
            "trimmedRatio": 0.0
        },
        "cadData": {
            "format": "DXF",
            "cadVersion": "PDF Vector / OCR",
            "units": "pt",
            "layers": [
                {"name": "PDF_TEXT", "color": "#0f172a", "visible": True, "entityCount": len(text_annotations)},
                {"name": "PDF_VECTOR", "color": "#2563eb", "visible": True, "entityCount": len(circles) + len(lines)}
            ],
            "layouts": [{"name": f"Page {page_idx+1}", "entityCount": len(entities)}],
            "entities": entities,
            "textAnnotations": text_annotations,
            "circles": circles,
            "bounds": {
                "minX": 0.0,
                "minY": 0.0,
                "maxX": output_w,
                "maxY": output_h,
                "width": output_w,
                "height": output_h
            },
            "blockNames": [],
            "totalEntityCount": len(entities),
            "polylineCount": len(lines),
            "circleCount": len(circles),
            "insertCount": 0,
            "textCount": len(text_annotations),
            "parseWarnings": []
        }
    }
    return result

def get_pdf_bounds(pdf_path, page_num=1):
    doc = pymupdf.open(pdf_path)
    page_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[page_idx]
    pw = float(page.rect.width)
    ph = float(page.rect.height)

    x0_list, y0_list, x1_list, y1_list = [], [], [], []

    # Vector drawings
    for d in page.get_drawings():
        r = d['rect']
        x0_list.append(r.x0)
        y0_list.append(r.y0)
        x1_list.append(r.x1)
        y1_list.append(r.y1)

    # Text blocks
    for b in page.get_text('blocks'):
        x0_list.append(b[0])
        y0_list.append(b[1])
        x1_list.append(b[2])
        y1_list.append(b[3])

    # Images
    try:
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                x0_list.append(r.x0)
                y0_list.append(r.y0)
                x1_list.append(r.x1)
                y1_list.append(r.y1)
    except Exception:
        pass

    if x0_list and x1_list:
        raw_x0 = max(0.0, min(x0_list))
        raw_y0 = max(0.0, min(y0_list))
        raw_x1 = min(pw, max(x1_list))
        raw_y1 = min(ph, max(y1_list))
    else:
        raw_x0, raw_y0, raw_x1, raw_y1 = 0.0, 0.0, pw, ph

    # Convert to PDF user space (origin bottom-left, Y-up)
    llx = raw_x0
    lly = max(0.0, ph - raw_y1)
    urx = raw_x1
    ury = min(ph, ph - raw_y0)

    # Small margin padding if tight ink borders found
    if urx - llx > 10 and ury - lly > 10:
        pad_x = max(2.0, min(8.0, (urx - llx) * 0.008))
        pad_y = max(2.0, min(8.0, (ury - lly) * 0.015))
        llx = max(0.0, llx - pad_x)
        lly = max(0.0, lly - pad_y)
        urx = min(pw, urx + pad_x)
        ury = min(ph, ury + pad_y)

    return {
        'pageNumber': page_idx + 1,
        'pageWidth': round(pw, 2),
        'pageHeight': round(ph, 2),
        'llx': round(llx, 2),
        'lly': round(lly, 2),
        'urx': round(urx, 2),
        'ury': round(ury, 2),
    }

def get_pdf_metadata(pdf_path, page_num=1):
    bounds = get_pdf_bounds(pdf_path, page_num)
    doc = pymupdf.open(pdf_path)
    page_idx = max(0, min(page_num - 1, len(doc) - 1))
    page = doc[page_idx]
    rect = page.rect
    pw, ph = rect.width, rect.height

    # Convert tight ink bounds (Y-up) into PyMuPDF top-down Rect
    x0 = max(0.0, float(bounds.get('llx', 0.0)))
    y0 = max(0.0, ph - float(bounds.get('ury', ph)))
    x1 = min(pw, float(bounds.get('urx', pw)))
    y1 = min(ph, ph - float(bounds.get('lly', 0.0)))
    cw = max(10.0, x1 - x0)
    ch = max(10.0, y1 - y0)

    texts = []
    header_texts = []
    embedded = page.get_text("text") or ""
    if embedded.strip():
        texts.append(embedded)

    # Render targeted high-DPI crops inside the ACTUAL drawing ink bounds:
    # 1. Top-center station header (tall enough to include Station ID & KM below station name)
    # 2. Full top header band, 3. Bottom-left title block, 4. Bottom-right title block
    crops = [
        (pymupdf.Rect(x0 + cw * 0.30, y0, x0 + cw * 0.70, y0 + ch * 0.38), min(7.0, max(5.0, 2400.0 / max(cw * 0.40, 1.0))), True),
        (pymupdf.Rect(x0, y0, x1, y0 + ch * 0.25), min(5.0, max(2.8, 2800.0 / max(cw, 1.0))), True),
        (pymupdf.Rect(x0, y0 + ch * 0.62, x0 + cw * 0.45, y1), min(6.0, max(3.5, 2200.0 / max(cw * 0.45, 1.0))), False),
        (pymupdf.Rect(x0 + cw * 0.55, y0 + ch * 0.62, x1, y1), min(6.0, max(3.5, 2200.0 / max(cw * 0.45, 1.0))), False),
    ]
    for clip, scale, is_hdr in crops:
        try:
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            ocr_txt = pytesseract.image_to_string(img)
            if ocr_txt.strip():
                texts.append(ocr_txt)
                if is_hdr:
                    header_texts.append(ocr_txt)
        except Exception:
            pass

    full_text = "\n".join(texts)
    header_text = "\n".join(header_texts)
    station_name = ""
    station_code = ""
    station_id = ""
    station_km = ""
    division = ""
    section = ""

    generic_phrases = {
        "LAYOUT", "PLAN", "SCALE", "TABLE", "SIGNAL", "NORMAL", "REVERSE", "MAIN",
        "LOOP", "COMMON", "SHEET", "DRAWING", "SECTION", "DIVISION", "RAILWAY",
        "KAVACH", "RFID", "TIN", "TRACK", "CIRCUIT", "OVERLAP", "ROUTE", "NOTES",
        "TEMPLATE", "SIGNALLING", "INTERLOCKING", "APPROVED", "CHECKED", "PREPARED",
        "AVOIDANCE SYSTEM", "COLLISION AVOIDANCE", "SYSTEM", "TCAS", "INDIAN RAILWAYS",
    }

    # 1. Station Name (Code), e.g. CHITGIDDA (CTF), JANAKAMPET (JKM)
    for line in full_text.splitlines():
        clean = re.sub(r'\s+', ' ', line).strip()
        if not clean:
            continue
        m_nc = re.search(r'\b([A-Z][A-Z\s.-]{2,24}?)\s*\(([A-Z]{2,5})\)', clean)
        if m_nc:
            cand_name = m_nc.group(1).strip(" .-:")
            cand_code = m_nc.group(2).strip()
            up_name = cand_name.upper()
            up_code = cand_code.upper()
            if (
                up_code not in {"TCAS", "RFID", "KAV", "TIN", "SIP", "TOC"}
                and up_name not in generic_phrases
                and not any(w in up_name for w in ["RFID", "LAYOUT", "PLAN", "TABLE", "AVOIDANCE", "SYSTEM", "RAILWAY"])
            ):
                station_name = station_name or cand_name
                station_code = station_code or cand_code
                break

    if not station_name:
        m_sn = re.search(r'Station\s*Name\s*[:=\-]?\s*([A-Za-z][A-Za-z\s.-]{2,24})', full_text, re.IGNORECASE)
        if m_sn:
            cand = m_sn.group(1).split('\n')[0].strip(" |_-:")
            if cand.upper() not in generic_phrases:
                station_name = cand

    if not station_code:
        m_sc = re.search(r'(?:Station|Stn)\s*Code\s*[:=\-]?\s*([A-Z]{2,5})\b', full_text, re.IGNORECASE)
        if m_sc:
            station_code = m_sc.group(1).upper()

    # 2. Station ID (handle common CAD typos like "Staion ID:520" and SHX OCR "1D:520")
    m_id = re.search(r'(?:Station|Staion|Stn\.?)\s*[I1]D\s*[:=\-]?\s*(\d{2,6})\b', header_text + "\n" + full_text, re.IGNORECASE)
    if m_id:
        station_id = m_id.group(1).strip()

    # 3. KM Details (prioritize explicit KM in header e.g. "Km.121.80." over trackside numbers)
    m_hdr_km = re.search(r'\bKM[\s.:=\-]*(\d{1,4}(?:\.\d{1,3})?)', header_text, re.IGNORECASE)
    if m_hdr_km:
        station_km = f"KM {m_hdr_km.group(1)}"
    else:
        m_stn_km = re.search(r'(?:STN\.?|STATION|CENTER|CENTRE)\s*KM[\s.:=\-]*(\d{1,4}(?:\.\d{1,3})?)', full_text, re.IGNORECASE)
        if m_stn_km:
            station_km = f"KM {m_stn_km.group(1)}"
        else:
            kms = []
            for m_k in re.finditer(r'\bKM[\s.:=\-]*(\d{1,4}(?:\.\d{1,3})?)\b', full_text, re.IGNORECASE):
                try:
                    v = float(m_k.group(1))
                    if 0 < v < 5000:
                        kms.append(v)
                except Exception:
                    pass
            if len(kms) == 1:
                station_km = f"KM {kms[0]}"
            elif len(kms) > 1:
                mn, mx = min(kms), max(kms)
                station_km = f"KM {mn}" if abs(mn - mx) < 0.001 else f"KM {mn} - {mx}"

    # 4. Division / Section
    m_div = re.search(r'([A-Za-z]+)\s+Division\b', full_text, re.IGNORECASE)
    if m_div:
        division = m_div.group(1).strip()
    m_sec = re.search(r'Section\s*[:=\-]?\s*([A-Za-z0-9\s\-/]{3,28})', full_text, re.IGNORECASE)
    if m_sec:
        sec_cand = m_sec.group(1).split('\n')[0].strip(" |_-:")
        if not sec_cand.upper().startswith("B "):
            section = sec_cand

    return {
        'stationName': station_name,
        'stationCode': station_code,
        'stationId': station_id,
        'stationKm': station_km,
        'division': division,
        'section': section,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python pdfOcrWorker.py <pdf_path> [page_num] [output_json_path]")
        sys.exit(1)

    if '--bounds' in sys.argv:
        pdf_path = sys.argv[1]
        page_num = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 1
        bounds = get_pdf_bounds(pdf_path, page_num)
        print(json.dumps(bounds, ensure_ascii=False))
        return

    if '--metadata' in sys.argv:
        pdf_path = sys.argv[1]
        page_num = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 1
        meta = get_pdf_metadata(pdf_path, page_num)
        print(json.dumps(meta, ensure_ascii=False))
        return
        
    pdf_path = sys.argv[1]
    page_num = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    output_path = sys.argv[3] if len(sys.argv) > 3 else None
    
    res = process_pdf(pdf_path, page_num)
    
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False)
        print(f"OK: Wrote {res['textCount']} texts, {len(res['cadData']['circles'])} circles to {output_path}")
    else:
        print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
