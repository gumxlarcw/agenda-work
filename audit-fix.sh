#!/bin/bash
# Interactive Audit Issue Selector for Agenda Work
# Usage: bash audit-fix.sh

# Colors
RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
MAG='\033[0;35m'
BLD='\033[1m'
DIM='\033[2m'
RST='\033[0m'

# Issue definitions: ID|Severity|Area|Description
ISSUES=(
  "C1|CRITICAL|Backend|IDOR in webhook task completion — no user_id ownership check"
  "C2|CRITICAL|Backend|Plaintext credentials in queue_meta — KipApp creds unencrypted in DB"
  "C3|CRITICAL|Frontend|XSS via javascript: URI — new URL() accepts javascript: protocol"
  "C4|CRITICAL|Frontend|isRefreshing race condition — no mutex on token refresh"
  "C5|CRITICAL|Infra|Hardcoded passwords in Python automation script"
  "C6|CRITICAL|Infra|NODE_ENV not set to production in ecosystem config"
  "C7|CRITICAL|Infra|Weak SESSION_SECRET — no minimum length enforcement"
  "C8|CRITICAL|Infra|Vite preview used in production — not production-grade"
  "C9|CRITICAL|Infra|Dynamic SQL in Python automation — potential SQL injection"
  "C10|CRITICAL|Backend|Unbounded automation queue — no cap on queued runs"
  "H1|HIGH|Backend|SSE connection leak — interval not cleared on all error paths"
  "H2|HIGH|Backend|No pagination cap — history endpoints accept unlimited limit"
  "H3|HIGH|Backend|Admin endpoints lack user_id validation"
  "H4|HIGH|Backend|Full process.env leaked to automation child process"
  "H5|HIGH|Backend|notification_days not validated — accepts arbitrary arrays"
  "H6|HIGH|Backend|Sequential WhatsApp broadcast — no batching"
  "H7|HIGH|Backend|Date params not validated — year/month accept non-numeric"
  "H8|HIGH|Frontend|checkAuth over-logout — redundant state reset with interceptor"
  "H9|HIGH|Frontend|Unstable fetch references — recreated each render"
  "H10|HIGH|Frontend|isRefreshing stuck on error — flag never resets"
  "H11|HIGH|Frontend|Reminders missing loading state — no spinner"
  "H12|HIGH|Frontend|No ErrorBoundary — lazy chunks fail with white screen"
  "H13|HIGH|Frontend|Hardcoded phone number in source code"
  "H14|HIGH|Infra|No log rotation — PM2 logs grow unbounded"
  "H15|HIGH|Infra|Timing attack on webhook secret — uses === not timingSafeEqual"
  "M1|MEDIUM|Backend|Health check too simple — no DB connectivity verify"
  "M2|MEDIUM|Infra|SSE no timeout — connections stay open indefinitely"
  "M3|MEDIUM|Infra|Helmet defaults too permissive — missing CSP, HSTS"
  "M4|MEDIUM|Infra|Outdated dependencies — no npm audit or Dependabot"
  "M5|MEDIUM|Infra|kill_timeout too short — 5s may not suffice"
  "M6|MEDIUM|Infra|Credential files only in .gitignore — no .dockerignore"
)

TOTAL=${#ISSUES[@]}
declare -a SELECTED
for ((i=0; i<TOTAL; i++)); do SELECTED[$i]=0; done

CURSOR=0
SCROLL_OFFSET=0

# Terminal height for scrolling
get_visible_rows() {
  local term_h=$(tput lines)
  echo $((term_h - 8))  # Reserve lines for header/footer
}

sev_color() {
  case "$1" in
    CRITICAL) echo -ne "$RED" ;;
    HIGH)     echo -ne "$YEL" ;;
    MEDIUM)   echo -ne "$CYN" ;;
  esac
}

area_color() {
  case "$1" in
    Backend)  echo -ne "$GRN" ;;
    Frontend) echo -ne "$MAG" ;;
    Infra)    echo -ne "$CYN" ;;
  esac
}

count_selected() {
  local c=0
  for s in "${SELECTED[@]}"; do ((c+=s)); done
  echo $c
}

draw() {
  local visible=$(get_visible_rows)

  # Adjust scroll
  if ((CURSOR < SCROLL_OFFSET)); then
    SCROLL_OFFSET=$CURSOR
  elif ((CURSOR >= SCROLL_OFFSET + visible)); then
    SCROLL_OFFSET=$((CURSOR - visible + 1))
  fi

  clear
  local sel_count=$(count_selected)
  echo -e "${BLD}╔══════════════════════════════════════════════════════════════════════╗${RST}"
  echo -e "${BLD}║  AGENDA WORK — Audit Issue Selector          ${sel_count}/${TOTAL} selected       ║${RST}"
  echo -e "${BLD}╚══════════════════════════════════════════════════════════════════════╝${RST}"
  echo -e "${DIM} ↑↓ Navigate  │  Space: Toggle  │  a: All  │  n: None  │  Enter: Confirm  │  q: Quit${RST}"
  echo ""

  local end=$((SCROLL_OFFSET + visible))
  if ((end > TOTAL)); then end=$TOTAL; fi

  for ((i=SCROLL_OFFSET; i<end; i++)); do
    IFS='|' read -r id sev area desc <<< "${ISSUES[$i]}"

    # Checkbox
    if ((SELECTED[i])); then
      checkbox="${GRN}[✓]${RST}"
    else
      checkbox="${DIM}[ ]${RST}"
    fi

    # Cursor indicator
    if ((i == CURSOR)); then
      cursor_mark="${BLD}▸${RST} "
    else
      cursor_mark="  "
    fi

    # Severity badge
    sev_c=$(sev_color "$sev")
    area_c=$(area_color "$area")

    printf "%s%s ${sev_c}%-8s${RST} ${area_c}%-8s${RST} ${BLD}%-4s${RST} %s\n" \
      "$cursor_mark" "$checkbox" "$sev" "$area" "$id" "$desc"
  done

  # Scroll indicator
  if ((SCROLL_OFFSET > 0)); then
    echo -e "${DIM}  ↑ more above${RST}"
  fi
  if ((end < TOTAL)); then
    echo -e "${DIM}  ↓ more below${RST}"
  fi
}

# Main loop
stty -echo
tput civis  # Hide cursor
trap 'tput cnorm; stty echo; echo' EXIT

draw

while true; do
  # Read single keypress
  IFS= read -rsn1 key

  case "$key" in
    # Arrow keys (escape sequence)
    $'\x1b')
      read -rsn2 rest
      case "$rest" in
        '[A') # Up
          ((CURSOR > 0)) && ((CURSOR--))
          ;;
        '[B') # Down
          ((CURSOR < TOTAL-1)) && ((CURSOR++))
          ;;
      esac
      ;;
    ' ') # Space — toggle
      SELECTED[$CURSOR]=$(( 1 - SELECTED[$CURSOR] ))
      ((CURSOR < TOTAL-1)) && ((CURSOR++))
      ;;
    'a'|'A') # Select all
      for ((i=0; i<TOTAL; i++)); do SELECTED[$i]=1; done
      ;;
    'n'|'N') # Select none
      for ((i=0; i<TOTAL; i++)); do SELECTED[$i]=0; done
      ;;
    'c'|'C') # Select all Critical
      for ((i=0; i<TOTAL; i++)); do
        IFS='|' read -r _ sev _ _ <<< "${ISSUES[$i]}"
        [[ "$sev" == "CRITICAL" ]] && SELECTED[$i]=1
      done
      ;;
    'h') # Select all High
      for ((i=0; i<TOTAL; i++)); do
        IFS='|' read -r _ sev _ _ <<< "${ISSUES[$i]}"
        [[ "$sev" == "HIGH" ]] && SELECTED[$i]=1
      done
      ;;
    'q'|'Q') # Quit
      tput cnorm
      stty echo
      echo ""
      echo -e "${YEL}Cancelled. No issues selected.${RST}"
      exit 0
      ;;
    '') # Enter — confirm
      break
      ;;
  esac

  draw
done

# Restore terminal
tput cnorm
stty echo

# Output selected issues
sel_count=$(count_selected)
echo ""

if ((sel_count == 0)); then
  echo -e "${YEL}No issues selected.${RST}"
  exit 0
fi

echo -e "${GRN}${BLD}Selected ${sel_count} issues to fix:${RST}"
echo ""

SELECTED_IDS=()
for ((i=0; i<TOTAL; i++)); do
  if ((SELECTED[i])); then
    IFS='|' read -r id sev area desc <<< "${ISSUES[$i]}"
    sev_c=$(sev_color "$sev")
    area_c=$(area_color "$area")
    printf "  ${sev_c}%-8s${RST} ${area_c}%-8s${RST} ${BLD}%-4s${RST} %s\n" "$sev" "$area" "$id" "$desc"
    SELECTED_IDS+=("$id")
  fi
done

echo ""

# Write selected IDs to file for processing
OUTFILE="/var/www/html/agenda_work/.audit-selected"
printf '%s\n' "${SELECTED_IDS[@]}" > "$OUTFILE"

echo -e "${GRN}Selected IDs written to: ${OUTFILE}${RST}"
echo -e "${DIM}IDs: ${SELECTED_IDS[*]}${RST}"
echo ""
echo -e "Copy this to Claude: ${BLD}fix issues: ${SELECTED_IDS[*]}${RST}"
