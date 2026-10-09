const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  boards: [],
  activeBoardId: null,
  editing: {
    type: null, // 'card' or 'column'
    id: null,
    element: null
  },
  dragging: {
    card: null,
    fromColumn: null,
    fromBoard: null
  },
  cardModal: {
    boardId: null,
    columnId: null,
    cardId: null
  },
  draftLabelIds: [],
  draftChecklists: []
};

const KEY = "kanban_boards_v1";

function applyTheme() {
  try {
    const theme = appStorage.getItem("edi_kanban_theme") ||
                  (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await window.appStorageReady;
  loadState();
  applyTheme();
  setupEventListeners();
  render();
  const link = new URLSearchParams(location.search);
  const linkedBoard = getBoard(link.get('board'));
  if (linkedBoard && link.get('card')) {
    const linkedColumn = linkedBoard.columns.find(column => column.cards.some(card => card.id === link.get('card')));
    if (linkedColumn) {
      state.activeBoardId = linkedBoard.id;
      saveState(); render();
      openCardModal({boardId: linkedBoard.id, columnId: linkedColumn.id, cardId: link.get('card')});
    }
  }
  checkCardReminders();
  setInterval(checkCardReminders, 60000);
});

function loadState() {
  try {
    const saved = appStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state.boards = parsed.boards || [];
      state.activeBoardId = parsed.activeBoardId || null;
      if (!state.activeBoardId && state.boards.length > 0) {
        state.activeBoardId = state.boards[0].id;
      }
      // Migrate existing boards to new column structure
      let migrated = false;
      state.boards.forEach(board => {
        if (board.columns && board.columns.length === 3) {
          migrated = true;
          // Add "To Review" and "Backlog" columns to existing boards
          const backlogCol = { id: crypto.randomUUID(), name: "Backlog", cards: [] };
          const reviewCol = { id: crypto.randomUUID(), name: "To Review", cards: [] };
          // Keep existing columns but rename if needed
          board.columns[0].name = "To Do";
          board.columns[1].name = "In Progress";
          board.columns[2].name = "Done";
          // Insert new columns
          board.columns.unshift(backlogCol);
          board.columns.splice(3, 0, reviewCol);
        }
        if (!Array.isArray(board.labelDefs)) { board.labelDefs = []; migrated = true; }
        board.columns.forEach(column => column.cards.forEach(card => {
          if (!Array.isArray(card.labelIds)) {
            migrated = true;
            card.labelIds = (card.labels || '').split(',').map(name => name.trim()).filter(Boolean).map(name => {
              let definition = board.labelDefs.find(label => label.name.toLowerCase() === name.toLowerCase());
              if (!definition) {
                const lower = name.toLowerCase();
                definition = {id: crypto.randomUUID(), name, color: lower.includes('urgent') || lower.includes('high') ? '#dc2626' : lower.includes('low') ? '#16a34a' : '#d97706'};
                board.labelDefs.push(definition);
              }
              return definition.id;
            });
            delete card.labels;
          }
          if (!Array.isArray(card.checklist)) { card.checklist = []; migrated = true; }
          if (typeof card.dueDate !== 'string') { card.dueDate = ''; migrated = true; }
        }));
      });
      if (migrated) saveState();
    } else {
      state.boards.push(createBoard("My Projects"));
      state.activeBoardId = state.boards[0].id;
    }
  } catch (e) {
    console.error("Failed to load kanban state:", e);
    state.boards = [createBoard("My Projects")];
    state.activeBoardId = state.boards[0].id;
  }
}

function setupEventListeners() {
  // Add board button
  $('addBoardBtn')?.addEventListener('click', () => openBoardModal());

  // Board form submit
  $('boardForm')?.addEventListener('submit', handleBoardSubmit);

  // Delete board
  $('deleteBoardBtn')?.addEventListener('click', () => {
    if (state.boards.length <= 1) {
      showToast('Cannot delete the last board', 'error');
      return;
    }
    if (!confirm('Delete this board and all its cards?')) return;
    const boardId = $('boardId').value;
    state.boards = state.boards.filter(b => b.id !== boardId);
    if (state.activeBoardId === boardId) {
      state.activeBoardId = state.boards[0].id;
    }
    saveState();
    render();
    closeModal('boardModal');
    showToast('Board deleted', 'success');
  });

  // Close modal
  $('closeBoardModal')?.addEventListener('click', () => closeModal('boardModal'));

  // Drag & drop for columns
  $('columnsContainer')?.addEventListener('dragover', handleCardContainerDragOver);
  $('columnsContainer')?.addEventListener('dragleave', handleCardContainerDragLeave);
  $('columnsContainer')?.addEventListener('drop', handleCardContainerDrop);

  // Close modal on backdrop click
  $('boardModal')?.addEventListener('click', (e) => {
    if (e.target === $('boardModal')) closeModal('boardModal');
  });

  // Card modal
  $('closeCardModal')?.addEventListener('click', closeCardModal);
  $('cardForm')?.addEventListener('submit', handleCardFormSubmit);
  $('cardModal')?.addEventListener('click', (e) => {
    if (e.target === $('cardModal')) closeCardModal();
  });
  $('deleteCardBtn')?.addEventListener('click', deleteCurrentCard);
  $('moveCardBtn').addEventListener('click', () => {
    document.querySelector('.editor-more').open = false;
    openMoveCard({...state.cardModal, fromEditor: true});
  });
  $('moveCardProject').addEventListener('change', renderMoveCardLists);
  $('moveCardForm').addEventListener('submit', moveCardToProject);
  ['closeMoveCard', 'cancelMoveCard'].forEach(id => $(id).addEventListener('click', () => {
    if (!state.moveCard?.busy) $('moveCardModal').close();
  }));
  $('moveCardModal').addEventListener('click', event => {
    if (event.target === $('moveCardModal') && !state.moveCard?.busy) $('moveCardModal').close();
  });
  $('moveCardModal').addEventListener('cancel', event => { if (state.moveCard?.busy) event.preventDefault(); });
  $('cardTitle')?.addEventListener('input', clearCardFormError);
  $('cardDescription')?.addEventListener('input', clearCardFormError);
  $('addLabelBtn')?.addEventListener('click', addBoardLabel);
  $('newLabelName')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addBoardLabel(); } });
  $('cardAddBtn').addEventListener('click', () => {
    const menu = $('cardAddMenu');
    if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
    menu.showPopover();
    const buttonRect = $('cardAddBtn').getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(buttonRect.left, window.innerWidth - menu.offsetWidth - 12))}px`;
    menu.style.top = `${Math.max(12, Math.min(buttonRect.bottom + 8, window.innerHeight - menu.offsetHeight - 12))}px`;
    $('closeCardAddMenu').focus();
  });
  $('cardAddMenu').addEventListener('toggle', e => $('cardAddBtn').setAttribute('aria-expanded', String(e.newState === 'open')));
  $('closeCardAddMenu').addEventListener('click', () => { $('cardAddMenu').hidePopover(); $('cardAddBtn').focus(); });
  document.querySelectorAll('[data-add-target]').forEach(button => button.addEventListener('click', () => {
    $('cardAddMenu').hidePopover();
    if (button.dataset.addTarget === 'cardDates') { openCardDates(); return; }
    if (button.dataset.addTarget === 'cardChecklistSection') { openChecklistMenu(); return; }
    if (button.dataset.addTarget === 'cardAttachmentsSection') { openAttachmentMenu(); return; }
    const panel = $(button.dataset.addTarget);
    panel.hidden = false;
    document.querySelectorAll(`[data-editor-target="${panel.id}"]`).forEach(trigger => trigger.setAttribute('aria-expanded', 'true'));
    panel.scrollIntoView({block: 'nearest'});
    panel.querySelector('input, select, textarea')?.focus();
  }));
  $('addCustomFieldBtn').addEventListener('click', () => {
    state.draftCustomFields.push({id: crypto.randomUUID(), name: '', value: ''});
    renderCustomFields();
    $('cardCustomFields').lastElementChild?.querySelector('input')?.focus();
  });
  window.addEventListener('resize', () => { if ($('cardAddMenu').matches(':popover-open')) $('cardAddMenu').hidePopover(); });
  $('cardDatesBtn').addEventListener('click', openCardDates);
  $('cardChecklistBtn').addEventListener('click', openChecklistMenu);
  $('closeCardChecklistMenu').addEventListener('click', closeChecklistMenu);
  $('cardChecklistMenu').addEventListener('toggle', e => $('cardChecklistBtn').setAttribute('aria-expanded', String(e.newState === 'open')));
  $('createChecklistBtn').addEventListener('click', createCardChecklist);
  $('newChecklistTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); createCardChecklist(); } });
  window.addEventListener('resize', () => { if ($('cardChecklistMenu').matches(':popover-open')) closeChecklistMenu(); });
  $('cardDateSummary').addEventListener('click', openCardDates);
  $('closeCardDatesMenu').addEventListener('click', closeCardDates);
  $('cardDatesMenu').addEventListener('toggle', e => $('cardDatesBtn').setAttribute('aria-expanded', String(e.newState === 'open')));
  $('saveCardDatesBtn').addEventListener('click', () => saveCardDates(false));
  $('removeCardDatesBtn').addEventListener('click', () => saveCardDates(true));
  document.querySelectorAll('[data-calendar-shift]').forEach(button => button.addEventListener('click', () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + Number(button.dataset.calendarShift), 1);
    renderDateCalendar();
  }));
  ['Start', 'Due'].forEach(kind => {
    $(`date${kind}Enabled`).addEventListener('change', () => {
      $(`datePicker${kind}`).disabled = !$(`date${kind}Enabled`).checked;
      if (kind === 'Due') $('datePickerTime').disabled = !$('dateDueEnabled').checked;
      if ($(`date${kind}Enabled`).checked) state.calendarTarget = kind;
      renderDateCalendar();
    });
    $(`datePicker${kind}`).addEventListener('focus', () => { state.calendarTarget = kind; renderDateCalendar(); });
    $(`datePicker${kind}`).addEventListener('change', () => {
      const date = parseCardDate($(`datePicker${kind}`).value);
      if (date) state.calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      state.calendarTarget = kind;
      renderDateCalendar();
    });
  });
  window.addEventListener('resize', () => { if ($('cardDatesMenu').matches(':popover-open')) closeCardDates(); });
  document.querySelectorAll('[data-editor-target]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.editorTarget === 'cardAttachmentsSection') { openAttachmentMenu(); return; }
      const panel = $(button.dataset.editorTarget);
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) panel.querySelector('input, select, textarea')?.focus();
    });
  });
  $('editDescriptionBtn').addEventListener('click', () => {
    const editing = $('cardDescription').hidden;
    $('cardDescription').hidden = !editing;
    $('cardDescriptionPreview').hidden = editing;
    $('editDescriptionBtn').textContent = editing ? 'Done' : 'Edit';
    if (editing) $('cardDescription').focus();
    else $('cardDescriptionPreview').textContent = $('cardDescription').value || 'Add a more detailed description…';
  });
  $('cardComment').addEventListener('input', () => { $('saveCommentBtn').hidden = !$('cardComment').value.trim(); });
  $('saveCommentBtn').addEventListener('click', saveCardComment);
  $('toggleActivityDetails').addEventListener('click', () => {
    const showing = $('cardActivityDetails').hidden;
    $('cardActivityDetails').hidden = !showing;
    $('toggleActivityDetails').textContent = showing ? 'Hide details' : 'Show details';
    $('toggleActivityDetails').setAttribute('aria-expanded', String(showing));
  });
  $('closeCardAttachMenu').addEventListener('click', () => $('cardAttachMenu').hidePopover());
  $('uploadCardFiles').addEventListener('change', async e => { await uploadCardFiles(Array.from(e.target.files || [])); e.target.value = ''; });
  const dropZone = $('attachmentDropZone');
  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); }));
  dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); uploadCardFiles(Array.from(e.dataTransfer.files || [])); });
  window.addEventListener('resize', () => { if ($('cardAttachMenu').matches(':popover-open')) $('cardAttachMenu').hidePopover(); });

  document.addEventListener('click', e => {
    if (!e.target.closest('.column-menu')) closeColumnMenus();
    document.querySelectorAll('.card-menu[open]').forEach(menu => { if (!menu.contains(e.target)) menu.open = false; });
  });
  document.addEventListener('toggle', e => {
    if (e.target.matches('.card-menu') && e.target.open) {
      closeColumnMenus();
      document.querySelectorAll('.card-menu[open]').forEach(menu => { if (menu !== e.target) menu.open = false; });
    }
  }, true);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('moveCardModal').open) return;
      if ($('cardAttachMenu').matches(':popover-open')) { e.preventDefault(); $('cardAttachMenu').hidePopover(); return; }
      if ($('cardChecklistMenu').matches(':popover-open')) { e.preventDefault(); closeChecklistMenu(); return; }
      if ($('cardDatesMenu').matches(':popover-open')) { e.preventDefault(); closeCardDates(); return; }
      if ($('cardAddMenu').matches(':popover-open')) { e.preventDefault(); $('cardAddMenu').hidePopover(); $('cardAddBtn').focus(); return; }
      const cardMenu = document.querySelector('.card-menu[open]');
      if (cardMenu) { cardMenu.open = false; cardMenu.querySelector('summary').focus(); return; }
      const openMenuButton = document.querySelector('.column-actions[aria-expanded="true"]');
      if (openMenuButton) { closeColumnMenus(); openMenuButton.focus(); }
      else if ($('cardModal')?.open) closeCardModal();
      else if ($('boardModal')?.open) closeModal('boardModal');
    }
  });
}

function saveState() {
  try {
    appStorage.setItem(KEY, JSON.stringify({
      boards: state.boards,
      activeBoardId: state.activeBoardId
    }));
  } catch (e) {
    console.error("Failed to save kanban state:", e);
    showToast("Unable to save board", "error");
  }
}

function createBoard(name) {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "New Board",
    labelDefs: [],
    columns: [
      { id: crypto.randomUUID(), name: "Backlog", cards: [] },
      { id: crypto.randomUUID(), name: "To Do", cards: [] },
      { id: crypto.randomUUID(), name: "In Progress", cards: [] },
      { id: crypto.randomUUID(), name: "To Review", cards: [] },
      { id: crypto.randomUUID(), name: "Done", cards: [] }
    ],
    createdAt: Date.now()
  };
}

function getBoard(id) {
  return state.boards.find(b => b.id === id);
}

function getActiveBoard() {
  return getBoard(state.activeBoardId);
}

function getColumn(boardId, columnId) {
  const board = getBoard(boardId);
  if (!board) return null;
  return board.columns.find(c => c.id === columnId);
}

// Inline edit helpers
function startInlineEdit(element, currentValue, onSave, onCancel) {
  // Remove any existing inline edit
  stopInlineEdit();

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue || '';
  input.className = 'inline-edit-input';
  input.style.cssText = `
    width: 100%;
    padding: 8px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  `;
  input.style.boxSizing = 'border-box';

  // Blink effect - add flashing border
  let blinkInterval;
  let isHighlighted = false;
  const blink = () => {
    isHighlighted = !isHighlighted;
    input.style.borderColor = isHighlighted ? 'var(--accent)' : '';
  };
  blinkInterval = setInterval(blink, 300);
  input._blinkInterval = blinkInterval;

  // Removing the input can fire blur, so only finish once.
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    clearInterval(blinkInterval);
    if (input.parentNode) {
      input.remove();
    }
    if (save && onSave) {
      onSave(input.value.trim());
    } else if (!save && onCancel) {
      onCancel();
    } else {
      element.textContent = currentValue || '';
    }
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });

  element.textContent = '';
  element.appendChild(input);
  input.focus();
  input.select();
}

function stopInlineEdit() {
  $$('.inline-edit-input').forEach(input => {
    if (input._blinkInterval) {
      clearInterval(input._blinkInterval);
    }
    input.remove();
  });
}

// Render everything
function render() {
  renderBoardTabs();
  renderBoardContent();
}

// Render board tabs
function renderBoardTabs() {
  const container = $('boardTabs');
  if (!container) return;

  container.innerHTML = '';

  state.boards.forEach(board => {
    const isActive = board.id === state.activeBoardId;
    const group = document.createElement('div');
    group.className = `board-tab-group ${isActive ? 'active' : ''}`;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'board-tab';
    tab.setAttribute('aria-current', isActive ? 'page' : 'false');
    tab.dataset.boardId = board.id;

    // Keep board navigation and settings as separate accessible buttons.
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = board.name;
    nameSpan.dataset.boardId = board.id;

    tab.insertBefore(nameSpan, tab.firstChild);

    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeBoardId = board.id;
      saveState();
      render();
    });
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'board-settings';
    settings.title = 'Board settings';
    settings.setAttribute('aria-label', `Settings for ${board.name}`);
    settings.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 3-.5 2-2 1.2-2-.6L3 9l1.5 1.5v3L3 15l2 3.4 2-.6L9 19l.5 2h5l.5-2 2-1.2 2 .6 2-3.4-1.5-1.5v-3L21 9l-2-3.4-2 .6L15 5l-.5-2Z"/><circle cx="12" cy="12" r="3"/></svg>';
    settings.addEventListener('click', () => openBoardModal(board.id));
    group.append(tab, settings);
    container.appendChild(group);
  });

  // Add board tab
  const addTab = document.createElement('button');
  addTab.className = 'board-add-tab';
  addTab.title = 'Add new board';
  addTab.textContent = '+ New board';
  addTab.addEventListener('click', () => openBoardModal());
  container.appendChild(addTab);
}

function startBoardRename(tabNameEl, boardId) {
  const currentText = tabNameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'board-rename-input';
  input.style.cssText = `
    width: 100%;
    padding: 4px 8px;
    background: var(--surface-2);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  `;

  let blinkInterval;
  let isHighlighted = false;
  const blink = () => {
    isHighlighted = !isHighlighted;
    input.style.borderColor = isHighlighted ? 'var(--accent)' : '';
  };
  blinkInterval = setInterval(blink, 300);
  input._blinkInterval = blinkInterval;

  tabNameEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = (save) => {
    clearInterval(blinkInterval);
    const newName = save ? input.value.trim() : currentText;
    const board = getBoard(boardId);
    if (board && newName) {
      board.name = newName;
      saveState();
    }
    render();
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      finish(false);
    }
  });
}

function startColumnRename(titleEl, columnId) {
  const currentText = titleEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  input.className = 'column-rename-input';
  input.style.cssText = `
    width: 100%;
    padding: 2px 6px;
    background: var(--surface-2);
    border: 1px solid var(--accent);
    border-radius: 3px;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    outline: none;
  `;

  let blinkInterval;
  let isHighlighted = false;
  const blink = () => {
    isHighlighted = !isHighlighted;
    input.style.borderColor = isHighlighted ? 'var(--accent)' : '';
  };
  blinkInterval = setInterval(blink, 300);
  input._blinkInterval = blinkInterval;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const finish = (save) => {
    clearInterval(blinkInterval);
    const newName = save ? input.value.trim() : currentText;
    const board = getActiveBoard();
    if (board && newName) {
      const col = board.columns.find(c => c.id === columnId);
      if (col) col.name = newName;
      saveState();
    }
    render();
  };

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      finish(false);
    }
  });
}

// Column drag & drop handlers
let columnDragState = {
  draggingColumnId: null
};

function handleColumnDragStart(e) {
  // If a card inside this column is the actual drag target, let the card handle it
  if (e.target.closest('.card')) {
    e.stopPropagation(); // prevent column drag from kicking in
    return;
  }

  const colEl = e.currentTarget;
  columnDragState.draggingColumnId = colEl.dataset.columnId;
  colEl.classList.add('column-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-column-id', colEl.dataset.columnId);
}

function handleColumnDragEnd(e) {
  const colEl = e.currentTarget;
  colEl.classList.remove('column-dragging');
  document.querySelectorAll('.column').forEach(c => c.classList.remove('column-drop-target'));
  columnDragState.draggingColumnId = null;
}

function handleColumnDragEnter(e) {
  if (columnDragState.draggingColumnId &&
      columnDragState.draggingColumnId !== e.currentTarget.dataset.columnId) {
    e.currentTarget.classList.add('column-drop-target');
  }
}

function handleColumnDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('column-drop-target');
  }
}

function handleColumnDropOnColumn(e) {
  const colEl = e.currentTarget;
  colEl.classList.remove('column-drop-target');

  if (!columnDragState.draggingColumnId) return;
  if (columnDragState.draggingColumnId === colEl.dataset.columnId) return;

  e.preventDefault();
  e.stopPropagation();

  const board = getActiveBoard();
  if (!board) return;

  const fromId = columnDragState.draggingColumnId;
  const toId = colEl.dataset.columnId;

  const fromIndex = board.columns.findIndex(c => c.id === fromId);
  const toIndex = board.columns.findIndex(c => c.id === toId);

  if (fromIndex === -1 || toIndex === -1) return;

  const [movedCol] = board.columns.splice(fromIndex, 1);
  board.columns.splice(toIndex, 0, movedCol);

  saveState();
  render();
  showToast('Column moved', 'success');
}

// Render board content (columns and cards) - simplified inline approach
function closeColumnMenus() {
  document.querySelectorAll('.column-actions-menu').forEach(menu => { menu.hidden = true; });
  document.querySelectorAll('.column-actions').forEach(button => button.setAttribute('aria-expanded', 'false'));
}

function renderBoardContent() {
  const container = $('columnsContainer');
  if (!container) return;

  const board = getActiveBoard();
  if (!board) {
    container.innerHTML = '<div class="empty-board"><h3>No boards</h3><p>Create a board to get started</p></div>';
    return;
  }

  $('boardMain').dataset.background = safeBoardBackground(board.background);
  $('boardHeading').textContent = board.name;
  $('boardDescription').textContent = board.description || '';
  $('boardDescription').hidden = !board.description;
  const cardCount = board.columns.reduce((total, column) => total + column.cards.length, 0);
  $('boardSummary').textContent = `${board.columns.length} lists · ${cardCount} cards`;
  container.innerHTML = '';

  board.columns.forEach(column => {
    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.columnId = column.id;
    colEl.draggable = true;

    colEl.innerHTML = `
      <div class="column-header">
        <div class="column-title-wrap">
          <span class="column-title">${escapeHtml(column.name)}</span>
          <span class="column-count">${column.cards.length}</span>
        </div>
        <div class="column-menu">
          <button class="icon-btn column-actions" type="button" aria-label="Actions for ${escapeHtml(column.name)}" aria-haspopup="menu" aria-expanded="false" title="Column actions">⋯</button>
          <div class="column-actions-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-action="add">Add card</button>
            <button type="button" role="menuitem" data-action="rename">Rename column</button>
            <div class="menu-divider" role="separator"></div>
            <button type="button" role="menuitem" data-action="delete" class="menu-danger">Delete column</button>
          </div>
        </div>
      </div>
      <div class="column-cards" id="column-${column.id}"></div>
      <div class="column-footer">
        <button class="add-card-btn" aria-label="Add card to ${escapeHtml(column.name)}">
          <span>+ Add card</span>
        </button>
      </div>
    `;

    // Rename column on double-click
    const titleSpan = colEl.querySelector('.column-title');
    titleSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startColumnRename(titleSpan, column.id);
    });

    // Add card button
    const addCardBtn = colEl.querySelector('.add-card-btn');
    addCardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Add a new card with default name
      const newCard = {
        id: crypto.randomUUID(),
        title: '',
        description: '',
        priority: 'medium',
        labelIds: [],
        dueDate: '',
        checklist: []
      };
      column.cards.push(newCard);
      saveState();
      render();

      // Immediately start renaming the new card
      setTimeout(() => {
        const newCardEl = document.querySelector(`[data-card-id="${newCard.id}"] .card-title`);
        if (newCardEl) {
          // Escape or an empty title discards the card that was just created.
          const discard = () => {
            column.cards = column.cards.filter(c => c.id !== newCard.id);
            saveState();
            render();
          };
          startInlineEdit(newCardEl, '', (newValue) => {
            if (!newValue) { discard(); return; }
            newCard.title = newValue;
            newCardEl.textContent = newValue;
            saveState();
            showToast('Card added', 'success');
          }, discard);
        }
      }, 50);
    });

    const actionsButton = colEl.querySelector('.column-actions');
    const actionsMenu = colEl.querySelector('.column-actions-menu');
    colEl.querySelector('.column-menu').addEventListener('dragstart', e => e.stopPropagation());
    actionsButton.addEventListener('click', e => {
      e.stopPropagation();
      const opening = actionsMenu.hidden;
      closeColumnMenus();
      actionsMenu.hidden = !opening;
      actionsButton.setAttribute('aria-expanded', String(opening));
      if (opening) actionsMenu.querySelector('button').focus();
    });
    actionsMenu.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...actionsMenu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    });
    actionsMenu.addEventListener('click', e => {
      e.stopPropagation();
      const action = e.target.closest('[data-action]')?.dataset.action;
      closeColumnMenus();
      if (action === 'add') { addCardBtn.click(); return; }
      if (action === 'rename') { startColumnRename(titleSpan, column.id); return; }
      if (action !== 'delete') return;
      if (column.cards.length > 0) {
        if (!confirm(`Delete column "${column.name}" and all its ${column.cards.length} card(s)?`)) return;
      } else {
        if (!confirm(`Delete column "${column.name}"?`)) return;
      }
      const board = getActiveBoard();
      board.columns = board.columns.filter(c => c.id !== column.id);
      saveState();
      render();
      showToast('Column deleted', 'success');
    });

    // Column drag & drop
    colEl.addEventListener('dragstart', handleColumnDragStart);
    colEl.addEventListener('dragend', handleColumnDragEnd);
    colEl.addEventListener('dragover', (e) => {
      // Only allow column drop if no card is being dragged
      if (columnDragState.draggingColumnId && e.dataTransfer.types.indexOf('text/x-card-id') === -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    colEl.addEventListener('drop', handleColumnDropOnColumn);
    colEl.addEventListener('dragenter', handleColumnDragEnter);
    colEl.addEventListener('dragleave', handleColumnDragLeave);

    // Render cards
    const cardsContainer = colEl.querySelector('.column-cards');
    column.cards.forEach((card, cardIndex) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card';
      cardEl.dataset.cardId = card.id;
      cardEl.dataset.cardIndex = cardIndex;
      cardEl.draggable = true;

      const priority = ['low', 'medium', 'high'].includes(card.priority) ? card.priority : 'medium';
      const priorityClass = `priority-${priority}`;

      // Labels HTML
      const labelsHtml = (card.labelIds || []).map(id => board.labelDefs.find(label => label.id === id)).filter(Boolean)
        .map(label => `<span class="label-tag" style="background:${safeLabelColor(label.color)};color:${labelTextColor(label.color)}">${escapeHtml(label.name)}</span>`).join('');
      const checklist = card.checklist || [];
      const completed = checklist.filter(item => item.done).length;
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(card.dueDate || '') ? card.dueDate : '';
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const dueClass = dueDate && column.name.toLowerCase() !== 'done' ? (dueDate < today ? 'overdue' : dueDate === today ? 'due-today' : '') : '';

      // Card content with inline edit support
      cardEl.innerHTML = `
        <div class="card-header">
          <span class="priority-dot ${priorityClass}" role="img" aria-label="${priority} priority" title="${priority} priority"></span>
          <h3 class="card-title" contenteditable="false">${escapeHtml(card.title)}</h3>
          <details class="card-menu"><summary aria-label="Card actions" title="Card actions">⋯</summary><div class="card-actions-menu"><button type="button" data-action="edit">Edit card</button><button type="button" data-action="move">Move to another project</button><button type="button" data-action="delete" class="menu-danger">Delete card</button></div></details>
        </div>
        ${card.description ? `<p class="card-desc">${escapeHtml(card.description)}</p>` : ''}
        ${labelsHtml ? `<div class="card-meta"><div class="card-labels">${labelsHtml}</div></div>` : ''}
        ${(dueDate || checklist.length) ? `<div class="card-details-meta">${dueDate ? `<span class="due-badge ${dueClass}" title="Due ${escapeHtml(dueDate)}">◷ ${escapeHtml(formatCardDueDate(dueDate))}</span>` : ''}${checklist.length ? `<span class="checklist-badge" title="Checklist progress">☑ ${completed}/${checklist.length}</span>` : ''}</div>` : ''}
      `;

      // Remove card
      cardEl.querySelector('.card-menu').addEventListener('click', (e) => e.stopPropagation());
      cardEl.querySelector('.card-menu').addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
      cardEl.querySelector('[data-action="edit"]').addEventListener('click', () => {
        cardEl.querySelector('.card-menu').open = false;
        openCardModal({ boardId: board.id, columnId: column.id, cardId: card.id });
      });
      cardEl.querySelector('[data-action="move"]').addEventListener('click', () => {
        cardEl.querySelector('.card-menu').open = false;
        openMoveCard({boardId: board.id, columnId: column.id, cardId: card.id, fromEditor: false});
      });
      cardEl.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete this card?')) return;
        column.cards.splice(cardIndex, 1);
        saveState();
        render();
        showToast('Card deleted', 'success');
      });

      // Open details from any part of the card, as on a Trello board.
      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('.card-menu')) return;
        if (e.target.closest('.inline-edit-input')) return;
        openCardModal({
          boardId: state.activeBoardId,
          columnId: column.id,
          cardId: card.id
        });
      });

      // Drag & drop
      cardEl.addEventListener('dragstart', handleDragStart);
      cardEl.addEventListener('dragend', handleDragEnd);

      cardsContainer.appendChild(cardEl);
    });

    container.appendChild(colEl);
  });

  // Single "Add column" button at the end
  const addColEl = document.createElement('div');
  addColEl.className = 'add-column-card';
  addColEl.innerHTML = `
    <button class="add-column-btn" aria-label="Add new column">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Add Column</span>
    </button>
  `;
  addColEl.querySelector('.add-column-btn').addEventListener('click', () => {
    const colName = prompt('Enter column name:');
    if (colName && colName.trim()) {
      const board = getActiveBoard();
      board.columns.push({
        id: crypto.randomUUID(),
        name: colName.trim(),
        cards: []
      });
      saveState();
      render();
      showToast('Column added', 'success');
    }
  });
  container.appendChild(addColEl);
}

// Modal handlers (kept for board management)
function openBoardModal(boardId = null) {
  // Defensive: if called with an event object, treat as new board
  if (boardId && typeof boardId === 'object') boardId = null;
  if (boardId && typeof boardId !== 'string') boardId = null;

  const modal = $('boardModal');
  if (boardId) {
    const board = getBoard(boardId);
    if (!board) return;
    $('boardModalTitle').textContent = 'Edit Board';
    $('boardId').value = board.id;
    $('boardName').value = board.name;
    $('boardDescriptionInput').value = board.description || '';
    $('boardForm').elements.boardBackground.value = safeBoardBackground(board.background);
    $('deleteBoardBtn').hidden = false;
  } else {
    $('boardModalTitle').textContent = 'New Board';
    $('boardForm').reset();
    $('boardId').value = '';
    $('deleteBoardBtn').hidden = true;
  }
  $('boardModal').showModal();
}

function handleBoardSubmit(e) {
  e.preventDefault();
  const boardId = $('boardId').value;
  const name = $('boardName').value.trim();
  const description = $('boardDescriptionInput').value.trim();
  const background = safeBoardBackground($('boardForm').elements.boardBackground.value);
  if (!name) {
    showToast('Please enter a board name', 'error');
    return;
  }
  if (boardId) {
    const board = getBoard(boardId);
    if (board) {
      board.name = name;
      board.description = description;
      board.background = background;
      showToast('Board settings saved', 'success');
    } else {
      showToast('Board not found', 'error');
    }
  } else {
    state.boards.push({...createBoard(name), description, background});
    state.activeBoardId = state.boards[state.boards.length - 1].id;
    showToast('Board created', 'success');
  }
  saveState();
  render();
  closeModal('boardModal');
}

function safeBoardBackground(value) {
  return ['default', 'mint', 'ocean', 'sunset', 'violet', 'slate'].includes(value) ? value : 'default';
}

// Drag & drop handlers
function handleDragStart(e) {
  const cardEl = e.target.closest('.card');
  if (!cardEl) return;

  state.dragging.card = cardEl;
  state.dragging.fromColumn = cardEl.closest('.column') ? cardEl.closest('.column').dataset.columnId : null;
  state.dragging.fromBoard = state.activeBoardId;

  cardEl.classList.add('dragging');

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-card-id', cardEl.dataset.cardId);

  // Don't let the column pick this up as a column drag
  e.stopPropagation();

  $$('.column-cards').forEach(col => col.classList.add('drag-over'));
}

function handleDragEnd(e) {
  const cardEl = state.dragging.card;
  if (cardEl) cardEl.classList.remove('dragging');
  $$('.column-cards').forEach(col => col.classList.remove('drag-over'));

  state.dragging = { card: null, fromColumn: null, fromBoard: null };
}

function handleCardContainerDragOver(e) {
  // Only allow drop if a card (not a column) is being dragged
  if (columnDragState.draggingColumnId) return;
  // Check what types are present
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('text/x-card-id') === -1) {
    // No card id in payload — might be a column or unknown
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleCardContainerDragLeave(e) {
  if (!e.target.classList.contains('column-cards')) {
    $$('.column-cards').forEach(col => col.classList.remove('drag-over'));
  }
}

function handleCardContainerDrop(e) {
  // If a column is being dragged, let the column handler do its job
  if (columnDragState.draggingColumnId) return;

  const cardId = e.dataTransfer.getData('text/x-card-id') || state.dragging.card?.dataset.cardId;
  if (!cardId) return;

  e.preventDefault();

  // Find the column the drop landed in
  const targetColEl = e.target.closest('.column-cards');
  if (!targetColEl) return;
  const targetColId = targetColEl.parentElement.dataset.columnId;

  // Find the card under the cursor, if any, so we can insert before it
  const cardUnder = e.target.closest('.card');
  const beforeCardId = cardUnder ? cardUnder.dataset.cardId : null;

  const board = getActiveBoard();
  if (!board) return;

  const toCol = board.columns.find(c => c.id === targetColId);
  if (!toCol) return;

  // Find the source column by locating the card id
  let fromCol = null;
  for (const col of board.columns) {
    if (col.cards.some(c => c.id === cardId)) { fromCol = col; break; }
  }
  if (!fromCol) return;

  const fromIndex = fromCol.cards.findIndex(c => c.id === cardId);
  if (fromIndex === -1) return;
  const [moved] = fromCol.cards.splice(fromIndex, 1);

  if (beforeCardId && beforeCardId !== cardId) {
    const insertAt = toCol.cards.findIndex(c => c.id === beforeCardId);
    if (insertAt === -1) toCol.cards.push(moved);
    else toCol.cards.splice(insertAt, 0, moved);
  } else {
    toCol.cards.push(moved);
  }

  saveState();
  render();
  showToast('Card moved', 'success');
}

// Utility functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;

  void toast.offsetWidth;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function closeModal(modalId) {
  const modal = $(modalId);
  if (modal && modal.open) {
    modal.close();
  }
}

// Card modal — open / close / save / delete
function safeLabelColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#2563eb';
}

function labelTextColor(hex) {
  const color = safeLabelColor(hex).slice(1);
  const channels = [0, 2, 4].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.36 ? '#172033' : '#ffffff';
}

function renderLabelOptions() {
  const board = getBoard(state.cardModal.boardId);
  const container = $('cardLabelOptions');
  container.replaceChildren();
  if (!board) return;
  board.labelDefs.forEach(label => {
    const row = document.createElement('div');
    row.className = 'label-option';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.draftLabelIds.includes(label.id);
    check.setAttribute('aria-label', `Assign ${label.name}`);
    check.addEventListener('change', () => {
      state.draftLabelIds = check.checked ? [...state.draftLabelIds, label.id] : state.draftLabelIds.filter(id => id !== label.id);
      renderSelectedCardLabels();
    });
    const color = document.createElement('input');
    color.type = 'color';
    color.value = safeLabelColor(label.color);
    color.setAttribute('aria-label', `Color for ${label.name}`);
    color.addEventListener('change', () => { label.color = color.value; saveState(); renderBoardContent(); renderSelectedCardLabels(); });
    const name = document.createElement('input');
    name.className = 'input';
    name.value = label.name;
    name.maxLength = 30;
    name.setAttribute('aria-label', 'Label name');
    name.addEventListener('change', () => {
      const next = name.value.trim();
      if (!next || board.labelDefs.some(other => other.id !== label.id && other.name.toLowerCase() === next.toLowerCase())) {
        name.value = label.name;
        showToast('Label names must be unique', 'error');
        return;
      }
      label.name = next;
      saveState();
      renderBoardContent();
      renderSelectedCardLabels();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Delete ${label.name} label`);
    remove.addEventListener('click', () => {
      if (!confirm(`Delete label "${label.name}" from this board and all cards?`)) return;
      board.labelDefs = board.labelDefs.filter(other => other.id !== label.id);
      board.columns.forEach(column => column.cards.forEach(card => { card.labelIds = (card.labelIds || []).filter(id => id !== label.id); }));
      state.draftLabelIds = state.draftLabelIds.filter(id => id !== label.id);
      saveState(); renderLabelOptions(); renderBoardContent();
    });
    row.append(check, color, name, remove);
    container.append(row);
  });
  renderSelectedCardLabels();
}

function renderSelectedCardLabels() {
  const board = getBoard(state.cardModal.boardId);
  const container = $('cardSelectedLabels');
  container.replaceChildren();
  (board?.labelDefs || []).filter(label => state.draftLabelIds.includes(label.id)).forEach(label => {
    const chip = document.createElement('span');
    chip.textContent = label.name;
    chip.style.background = safeLabelColor(label.color);
    chip.style.color = labelTextColor(label.color);
    container.append(chip);
  });
}

function addBoardLabel() {
  const board = getBoard(state.cardModal.boardId);
  if (!board) return;
  const name = $('newLabelName').value.trim();
  if (!name || board.labelDefs.some(label => label.name.toLowerCase() === name.toLowerCase())) {
    showToast('Enter a unique label name', 'error');
    return;
  }
  const label = {id: crypto.randomUUID(), name, color: safeLabelColor($('newLabelColor').value)};
  board.labelDefs.push(label);
  state.draftLabelIds.push(label.id);
  $('newLabelName').value = '';
  saveState(); renderLabelOptions();
}

function renderChecklist() {
  const container = $('cardChecklist');
  container.replaceChildren();
  $('cardChecklistSection').hidden = !state.draftChecklists.length;
  state.draftChecklists.forEach(list => {
    const group = document.createElement('section');
    group.className = 'named-checklist';
    group.innerHTML = '<div class="trello-section-heading"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/></svg><input class="checklist-name" maxlength="60" /><button type="button" class="delete-checklist">Delete</button></div><div class="checklist-progress-row"><span></span><progress max="100" value="0"></progress></div><div class="checklist-items"></div><button type="button" class="checklist-open-add">Add an item</button><div class="checklist-item-composer" hidden><textarea class="input" rows="2" maxlength="120" placeholder="Add an item…"></textarea><div><button type="button" class="btn-primary">Add</button><button type="button" class="btn-ghost">Cancel</button></div></div>';
    const name = group.querySelector('.checklist-name');
    name.value = list.title;
    name.setAttribute('aria-label', 'Checklist title');
    name.addEventListener('change', () => { list.title = name.value.trim() || 'Checklist'; name.value = list.title; persistCardChecklists(); });
    group.querySelector('.delete-checklist').addEventListener('click', () => {
      if (!confirm(`Delete checklist "${list.title}" and its items?`)) return;
      state.draftChecklists = state.draftChecklists.filter(other => other.id !== list.id);
      persistCardChecklists(); renderChecklist();
    });
    const done = list.items.filter(item => item.done).length;
    const percent = list.items.length ? Math.round(done / list.items.length * 100) : 0;
    group.querySelector('.checklist-progress-row span').textContent = `${percent}%`;
    const progress = group.querySelector('progress');
    progress.value = percent;
    progress.setAttribute('aria-label', `${list.title}: ${done} of ${list.items.length} complete`);
    const items = group.querySelector('.checklist-items');
    list.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'checklist-item';
      const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = !!item.done;
      check.setAttribute('aria-label', `Complete ${item.text}`);
      check.addEventListener('change', () => { item.done = check.checked; persistCardChecklists(); renderChecklist(); });
      const input = document.createElement('input');
      input.className = 'input'; input.value = item.text; input.maxLength = 120;
      input.setAttribute('aria-label', 'Checklist item');
      input.addEventListener('input', () => { item.text = input.value; });
      input.addEventListener('change', () => { if (!item.text.trim()) { item.text = 'Untitled item'; input.value = item.text; } persistCardChecklists(); });
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'checklist-remove-item';
      remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';
      remove.setAttribute('aria-label', `Remove ${item.text}`);
      remove.addEventListener('click', () => { list.items = list.items.filter(entry => entry.id !== item.id); persistCardChecklists(); renderChecklist(); });
      row.append(check, input, remove);
      items.append(row);
    });
    const open = group.querySelector('.checklist-open-add');
    const composer = group.querySelector('.checklist-item-composer');
    const text = composer.querySelector('textarea');
    text.setAttribute('aria-label', `New item in ${list.title}`);
    open.addEventListener('click', () => { open.hidden = true; composer.hidden = false; text.focus(); });
    composer.querySelector('.btn-primary').addEventListener('click', () => addChecklistItem(list, text));
    composer.querySelector('.btn-ghost').addEventListener('click', () => { composer.hidden = true; open.hidden = false; text.value = ''; open.focus(); });
    text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addChecklistItem(list, text); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); composer.hidden = true; open.hidden = false; open.focus(); }
    });
    container.append(group);
  });
}

function addChecklistItem(list, input) {
  const text = input.value.trim();
  if (!text) return;
  list.items.push({id: crypto.randomUUID(), text, done: false});
  input.value = '';
  persistCardChecklists();
  renderChecklist();
  const index = state.draftChecklists.findIndex(other => other.id === list.id);
  $('cardChecklist').children[index]?.querySelector('.checklist-open-add')?.click();
}

function serializeDraftChecklists() {
  return state.draftChecklists.map(list => ({id: list.id, title: list.title.trim() || 'Checklist', items: list.items.filter(item => item.text.trim()).map(item => ({...item, text: item.text.trim()}))}));
}

function persistCardChecklists() {
  const card = currentModalCard();
  if (!card) return;
  card.checklists = serializeDraftChecklists();
  card.checklist = card.checklists.flatMap(list => list.items);
  card.updatedAt = Date.now();
  saveState(); renderBoardContent();
}

function openChecklistMenu() {
  const menu = $('cardChecklistMenu');
  if (menu.matches(':popover-open')) { closeChecklistMenu(); return; }
  $('newChecklistTitle').value = 'Checklist';
  $('checklistTitleError').hidden = true;
  menu.showPopover();
  const anchor = $('cardChecklistBtn').getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - menu.offsetHeight - 12))}px`;
  $('newChecklistTitle').focus(); $('newChecklistTitle').select();
}

function closeChecklistMenu() {
  $('cardChecklistMenu').hidePopover();
  $('cardChecklistBtn').focus();
}

function createCardChecklist() {
  const title = $('newChecklistTitle').value.trim();
  if (!title) { $('checklistTitleError').textContent = 'Enter a checklist title.'; $('checklistTitleError').hidden = false; $('newChecklistTitle').focus(); return; }
  state.draftChecklists.push({id: crypto.randomUUID(), title, items: []});
  persistCardChecklists(); renderChecklist(); closeChecklistMenu();
  const group = $('cardChecklist').lastElementChild;
  group.scrollIntoView({block: 'nearest'});
  group.querySelector('.checklist-open-add').click();
}

function openMoveCard(context) {
  const card = getColumn(context.boardId, context.columnId)?.cards.find(item => item.id === context.cardId);
  if (!card) return;
  state.moveCard = {...context, busy: false};
  $('moveCardSummary').textContent = card.title || 'Untitled card';
  $('moveCardError').hidden = true;
  const projects = state.boards.filter(board => board.id !== context.boardId);
  $('moveCardProject').replaceChildren();
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    $('moveCardProject').append(option);
  }
  if (!projects.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No other projects yet';
    $('moveCardProject').append(option);
  }
  ['closeMoveCard', 'cancelMoveCard'].forEach(id => { $(id).disabled = false; });
  $('moveCardProject').disabled = !projects.length;
  renderMoveCardLists();
  $('moveCardModal').showModal();
}

function renderMoveCardLists() {
  const project = getBoard($('moveCardProject').value);
  const columns = project?.columns || [];
  $('moveCardList').replaceChildren();
  for (const column of columns) {
    const option = document.createElement('option');
    option.value = column.id;
    option.textContent = column.name;
    $('moveCardList').append(option);
  }
  if (!columns.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No lists available';
    $('moveCardList').append(option);
  }
  const source = getColumn(state.moveCard.boardId, state.moveCard.columnId);
  const similar = columns.find(column => column.name.trim().toLowerCase() === source?.name.trim().toLowerCase());
  if (similar) $('moveCardList').value = similar.id;
  $('moveCardList').disabled = !columns.length;
  $('confirmMoveCard').disabled = !columns.length;
  $('confirmMoveCard').textContent = 'Move card';
  $('moveCardError').hidden = !!columns.length;
  $('moveCardError').textContent = project ? 'Add a list to this project before moving a card.' : 'Create another project first, then move this card.';
}

async function moveCardToProject(event) {
  event.preventDefault();
  const context = state.moveCard;
  if (!context || context.busy) return;
  const destinationBoardId = $('moveCardProject').value;
  const destinationColumnId = $('moveCardList').value;
  if (!getColumn(destinationBoardId, destinationColumnId) || destinationBoardId === context.boardId) return;
  if (context.fromEditor && $('cardModal').open) {
    handleCardFormSubmit({preventDefault() {}});
    if ($('cardModal').open) { $('moveCardModal').close(); $('cardTitle').focus(); return; }
    context.fromEditor = false;
  }
  // Saving the editor may have changed the card's list within its current project.
  const source = getBoard(context.boardId)?.columns.find(column => column.cards.some(card => card.id === context.cardId));
  if (!source) { $('moveCardError').textContent = 'Card not found. Reload the board and try again.'; $('moveCardError').hidden = false; return; }
  context.busy = true;
  ['moveCardProject', 'moveCardList', 'confirmMoveCard', 'cancelMoveCard', 'closeMoveCard'].forEach(id => { $(id).disabled = true; });
  $('confirmMoveCard').textContent = 'Moving…';
  $('moveCardError').hidden = true;
  try {
    const value = await appStorage.mutateItem(KEY, async ({csrf, revision}) => {
      const response = await fetch('/kanban.php', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: {'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf},
        body: JSON.stringify({source_board_id: context.boardId, source_column_id: source.id, card_id: context.cardId, destination_board_id: destinationBoardId, destination_column_id: destinationColumnId, revision})
      });
      let payload;
      try { payload = await response.json(); } catch { throw new Error('The server could not process the move. Please try again.'); }
      if (!response.ok) {
        const error = new Error(payload.error?.message || (typeof payload.error === 'string' ? payload.error : 'Unable to move the card. Please try again.'));
        error.stateConflict = payload.error?.code === 'state_conflict';
        throw error;
      }
      return payload.data;
    });
    const saved = JSON.parse(value);
    state.boards = saved.boards;
    state.activeBoardId = saved.activeBoardId;
    $('moveCardModal').close();
    render();
    showToast(`Card moved to ${getBoard(destinationBoardId)?.name || 'project'}`, 'success');
  } catch (error) {
    $('moveCardError').textContent = ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
      ? 'The move could not be confirmed. Reload to check the card before trying again.'
      : error.message || 'Unable to move the card.';
    $('moveCardError').hidden = false;
  } finally {
    context.busy = false;
    ['moveCardProject', 'moveCardList', 'confirmMoveCard', 'cancelMoveCard', 'closeMoveCard'].forEach(id => { $(id).disabled = false; });
    $('confirmMoveCard').textContent = 'Move card';
  }
}

function openCardModal({ boardId, columnId, cardId }) {
  const board = getBoard(boardId);
  if (!board) return;
  const column = board.columns.find(c => c.id === columnId);
  if (!column) return;
  const card = column.cards.find(c => c.id === cardId);
  if (!card) return;

  state.cardModal = { boardId, columnId, cardId };
  $('cardBoardId').value = boardId;
  $('cardColumnId').value = columnId;
  $('cardId').value = cardId;
  $('cardModalTitle').textContent = 'Edit card';
  $('cardTitle').value = card.title || '';
  $('cardDescription').value = card.description || '';
  $('cardPriority').value = card.priority || 'medium';
  $('cardDueDate').value = card.dueDate || '';
  updateCardDateSummary(card);
  $('cardCompleted').checked = !!card.completed;
  $('cardMembers').value = (card.members || []).join(', ');
  $('cardAttachmentUrl').value = card.attachmentUrl || '';
  $('legacyAttachmentField').hidden = !card.attachmentUrl;
  state.fileAttachments = [];
  $('cardFileAttachments').replaceChildren();
  loadCardAttachments();
  $('cardList').replaceChildren();
  board.columns.forEach(list => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.name;
    option.selected = list.id === columnId;
    $('cardList').append(option);
  });
  ['cardExtra', 'cardDates', 'cardMembersSection', 'cardAttachmentsSection', 'cardLabelsEditor'].forEach(id => { $(id).hidden = true; });
  document.querySelectorAll('[data-editor-target]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  $('cardDates').hidden = !card.dueDate && !card.startDate;
  $('cardMembersSection').hidden = !(card.members || []).length;
  $('cardAttachmentsSection').hidden = !card.attachmentUrl;
  $('cardChecklistSection').hidden = !(card.checklist || []).length;
  $('cardDescription').hidden = true;
  $('cardDescriptionPreview').hidden = false;
  $('cardDescriptionPreview').textContent = card.description || 'Add a more detailed description…';
  $('editDescriptionBtn').textContent = 'Edit';
  $('cardComment').value = '';
  $('saveCommentBtn').hidden = true;
  $('cardActivityDetails').hidden = true;
  $('toggleActivityDetails').textContent = 'Show details';
  $('toggleActivityDetails').setAttribute('aria-expanded', 'false');
  renderCardActivity(card);
  state.draftLabelIds = [...(card.labelIds || [])];
  state.draftChecklists = Array.isArray(card.checklists)
    ? card.checklists.map(list => ({...list, items: (list.items || []).map(item => ({...item}))}))
    : (card.checklist || []).length ? [{id: `legacy-${card.id}`, title: card.checklistTitle || 'Checklist', items: card.checklist.map(item => ({...item}))}] : [];
  state.draftCustomFields = (card.customFields || []).map(field => ({...field}));
  renderCustomFields();
  $('cardExtra').hidden = !state.draftCustomFields.length;
  renderLabelOptions();
  renderChecklist();
  clearCardFormError();
  const meta = column.name + (card.updatedAt ? ' · updated ' + new Date(card.updatedAt).toLocaleDateString() : '');
  $('cardFormMeta').textContent = meta;
  $('cardModal').showModal();
  setTimeout(() => $('cardTitle').focus(), 60);
}

function closeCardModal() {
  if ($('cardAttachMenu').matches(':popover-open')) $('cardAttachMenu').hidePopover();
  if ($('cardChecklistMenu').matches(':popover-open')) $('cardChecklistMenu').hidePopover();
  if ($('cardDatesMenu').matches(':popover-open')) $('cardDatesMenu').hidePopover();
  if ($('cardAddMenu').matches(':popover-open')) $('cardAddMenu').hidePopover();
  $('cardModal').close();
  state.cardModal = { boardId: null, columnId: null, cardId: null };
}

function setCardFormError(message) {
  const el = $('cardFormError');
  el.textContent = message;
  el.hidden = false;
}

function clearCardFormError() {
  const el = $('cardFormError');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

function handleCardFormSubmit(e) {
  e.preventDefault();
  const { boardId, columnId, cardId } = state.cardModal;
  if (!boardId || !columnId || !cardId) return;
  const board = getBoard(boardId);
  if (!board) return;
  const column = board.columns.find(c => c.id === columnId);
  if (!column) return;
  const card = column.cards.find(c => c.id === cardId);
  if (!card) return;

  const title = $('cardTitle').value.trim();
  if (!title) {
    setCardFormError('Give the card a title.');
    $('cardTitle').focus();
    return;
  }

  const attachmentUrl = $('cardAttachmentUrl').value.trim();
  if (attachmentUrl && !/^https?:\/\//i.test(attachmentUrl)) {
    $('cardAttachmentsSection').hidden = false;
    setCardFormError('Use an http or https attachment link.');
    $('cardAttachmentUrl').focus();
    return;
  }

  card.title = title;
  card.description = $('cardDescription').value.trim();
  card.priority = $('cardPriority').value;
  card.dueDate = $('cardDueDate').value;
  card.labelIds = state.draftLabelIds.filter(id => board.labelDefs.some(label => label.id === id));
  card.checklists = serializeDraftChecklists();
  card.checklist = card.checklists.flatMap(list => list.items);
  card.updatedAt = Date.now();
  const newlyCompleted = !card.completed && $('cardCompleted').checked;
  card.completed = $('cardCompleted').checked;
  card.members = $('cardMembers').value.split(',').map(name => name.trim()).filter(Boolean);
  card.customFields = state.draftCustomFields.filter(field => field.name.trim()).map(field => ({...field, name: field.name.trim(), value: field.value.trim()}));
  card.attachmentUrl = attachmentUrl;
  const destination = board.columns.find(list => list.id === $('cardList').value);
  if (destination && destination.id !== columnId) {
    column.cards = column.cards.filter(item => item.id !== cardId);
    destination.cards.push(card);
  }
  if (newlyCompleted && card.recurring && card.recurring !== 'never' && card.dueDate) {
    const next = parseCardDate(card.dueDate);
    if (next) {
      const originalDay = next.getDate();
      if (card.recurring === 'monthly') {
        next.setDate(1); next.setMonth(next.getMonth() + 1);
        next.setDate(Math.min(originalDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else next.setDate(next.getDate() + (card.recurring === 'weekly' ? 7 : 1));
      card.dueDate = cardDateString(next);
      card.completed = false;
    }
  }

  saveState();
  render();
  closeCardModal();
  showToast('Card saved', 'success');
}

function attachmentSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function attachmentCsrf() {
  const response = await fetch('/state.php', {headers: {Accept: 'application/json'}, cache: 'no-store', redirect: 'error'});
  if (!response.ok) throw new Error('Please sign in again and reload the page.');
  return (await response.json()).csrf;
}

async function attachmentResponse(response) {
  if (!(response.headers.get('Content-Type') || '').includes('application/json')) {
    throw new Error(response.status === 404 ? 'Attachment service is unavailable. Reload the page and try again.' : 'Unable to access attachments. Please reload or sign in again.');
  }
  return response.json();
}

async function loadCardAttachments() {
  const {boardId, cardId} = state.cardModal;
  try {
    const response = await fetch(`/attachments.php?board=${encodeURIComponent(boardId)}&card=${encodeURIComponent(cardId)}`, {headers: {Accept: 'application/json'}, cache: 'no-store', redirect: 'error'});
    const data = await attachmentResponse(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load attachments.');
    if (state.cardModal.boardId !== boardId || state.cardModal.cardId !== cardId) return;
    const byId = new Map((data.attachments || []).map(file => [file.id, file]));
    state.fileAttachments.forEach(file => byId.set(file.id, file));
    state.fileAttachments = Array.from(byId.values());
    state.attachmentMaxSize = data.maxSize;
    $('attachmentSizeLimit').textContent = `Up to ${attachmentSize(data.maxSize)} per file`;
    renderFileAttachments();
  } catch (error) {
    if (state.cardModal.boardId !== boardId || state.cardModal.cardId !== cardId) return;
    const message = document.createElement('p');
    message.className = 'attachment-error'; message.textContent = error.message;
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'btn-ghost'; retry.textContent = 'Retry';
    retry.addEventListener('click', loadCardAttachments);
    $('cardFileAttachments').replaceChildren(message, retry);
    $('cardAttachmentsSection').hidden = false;
  }
}

function renderFileAttachments() {
  const container = $('cardFileAttachments');
  container.replaceChildren();
  $('cardAttachmentsSection').hidden = !state.fileAttachments.length && !$('cardAttachmentUrl').value;
  state.fileAttachments.forEach(file => {
    const row = document.createElement('div');
    row.className = 'card-file-attachment';
    const icon = document.createElement('span');
    icon.className = 'card-file-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13H5V3Z"/><path d="M14 3v6h5M8 13h8M8 17h5"/></svg>';
    const info = document.createElement('div');
    const download = document.createElement('a');
    download.href = `/attachments.php?id=${encodeURIComponent(file.id)}`;
    download.textContent = file.name;
    download.setAttribute('download', file.name);
    const size = document.createElement('small');
    size.textContent = `${attachmentSize(file.size)} · Download`;
    info.append(download, size);
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-ghost'; remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove attachment "${file.name}"?`)) return;
      remove.disabled = true;
      const {boardId, cardId} = state.cardModal;
      try {
        const csrf = await attachmentCsrf();
        const response = await fetch(`/attachments.php?id=${encodeURIComponent(file.id)}`, {method: 'DELETE', headers: {Accept: 'application/json', 'X-CSRF-Token': csrf}, redirect: 'error'});
        const result = await attachmentResponse(response);
        if (!response.ok) throw new Error(result.error || 'Unable to remove attachment.');
        if (state.cardModal.boardId === boardId && state.cardModal.cardId === cardId) {
          state.fileAttachments = state.fileAttachments.filter(other => other.id !== file.id);
          renderFileAttachments();
        }
      } catch (error) { showToast(error.message, 'error'); remove.disabled = false; }
    });
    row.append(icon, info, remove);
    container.append(row);
  });
}

function openAttachmentMenu() {
  const menu = $('cardAttachMenu');
  if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
  if (!state.uploadingAttachments) $('attachmentUploadStatus').textContent = '';
  menu.showPopover();
  const anchor = document.querySelector('.trello-action-row [data-editor-target="cardAttachmentsSection"]').getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - menu.offsetHeight - 12))}px`;
  $('uploadCardFiles').focus();
}

async function uploadCardFiles(files) {
  if (!files.length || state.uploadingAttachments) return;
  const {boardId, cardId} = state.cardModal;
  if (!boardId || !cardId) return;
  state.uploadingAttachments = true;
  $('uploadCardFiles').disabled = true;
  const status = $('attachmentUploadStatus');
  status.classList.remove('attachment-error');
  const progress = $('attachmentUploadProgress');
  progress.hidden = false;
  const failures = [];
  let uploaded = 0;
  try {
    const csrf = await attachmentCsrf();
    for (const file of files) {
      if (state.cardModal.boardId !== boardId || state.cardModal.cardId !== cardId) break;
      if (file.size > (state.attachmentMaxSize || 8 * 1048576)) { failures.push(`${file.name}: file is too large`); continue; }
      status.textContent = `Uploading ${file.name}…`;
      progress.value = 0;
      try {
        const attachment = await new Promise((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('POST', '/attachments.php');
          request.setRequestHeader('Accept', 'application/json');
          request.setRequestHeader('X-CSRF-Token', csrf);
          request.timeout = 120000;
          request.upload.onprogress = e => { if (e.lengthComputable) progress.value = Math.round(e.loaded / e.total * 100); };
          request.onload = () => {
            try {
              if (!(request.getResponseHeader('Content-Type') || '').includes('application/json')) throw new Error('Attachment service is unavailable. Reload the page and try again.');
              const result = JSON.parse(request.responseText);
              if (request.status < 200 || request.status >= 300) throw new Error(result.error || 'Upload failed.');
              resolve(result.attachment);
            } catch (error) { reject(new Error(error.message || 'Upload failed.')); }
          };
          request.onerror = () => reject(new Error('Connection lost. Please try again.'));
          request.ontimeout = () => reject(new Error('Upload timed out. Please try again.'));
          const data = new FormData();
          data.append('board', boardId); data.append('card', cardId); data.append('file', file);
          request.send(data);
        });
        uploaded++;
        if (state.cardModal.boardId === boardId && state.cardModal.cardId === cardId) {
          state.fileAttachments.push(attachment);
          renderFileAttachments();
        }
      } catch (error) { failures.push(`${file.name}: ${error.message}`); }
    }
    status.textContent = [`${uploaded} file${uploaded === 1 ? '' : 's'} attached.`, ...failures].join('\n');
    status.classList.toggle('attachment-error', failures.length > 0);
  } catch (error) { status.textContent = error.message; status.classList.add('attachment-error'); }
  finally {
    state.uploadingAttachments = false;
    $('uploadCardFiles').disabled = false;
    progress.hidden = true;
  }
}

function cardDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatCardDueDate(value) {
  const date = parseCardDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : value;
}

function parseCardDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return cardDateString(date) === value ? date : null;
}

function currentModalCard() {
  const {boardId, columnId, cardId} = state.cardModal;
  return getColumn(boardId, columnId)?.cards.find(card => card.id === cardId);
}

function updateCardDateSummary(card) {
  $('cardDates').hidden = !card.startDate && !card.dueDate;
  $('cardDateSummary').textContent = [card.startDate ? `Start ${formatCardDueDate(card.startDate)}` : '', card.dueDate ? `Due ${formatCardDueDate(card.dueDate)}${card.dueTime ? ' · ' + card.dueTime : ''}` : ''].filter(Boolean).join(' → ');
}

function openCardDates() {
  const card = currentModalCard();
  if (!card) return;
  const menu = $('cardDatesMenu');
  if (menu.matches(':popover-open')) { closeCardDates(); return; }
  $('datePickerStart').value = card.startDate || '';
  $('dateStartEnabled').checked = !!card.startDate;
  $('datePickerStart').disabled = !card.startDate;
  $('datePickerDue').value = card.dueDate || cardDateString(new Date());
  $('dateDueEnabled').checked = true;
  $('datePickerDue').disabled = false;
  $('datePickerTime').value = card.dueTime || '09:00';
  $('datePickerTime').disabled = false;
  $('datePickerRecurring').value = card.recurring || 'never';
  $('datePickerReminder').value = card.reminder || 'none';
  $('datePickerError').hidden = true;
  state.calendarTarget = 'Due';
  const selected = parseCardDate($('datePickerDue').value) || new Date();
  state.calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
  renderDateCalendar();
  menu.showPopover();
  const anchor = $('cardDatesBtn').getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - menu.offsetHeight - 12))}px`;
  $('closeCardDatesMenu').focus();
}

function closeCardDates() {
  $('cardDatesMenu').hidePopover();
  $('cardDatesBtn').focus();
}

function renderDateCalendar() {
  const month = state.calendarMonth;
  $('dateCalendarMonth').textContent = month.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
  const first = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const today = cardDateString(new Date());
  const selected = $(`datePicker${state.calendarTarget}`).value;
  const grid = $('dateCalendarDays');
  grid.replaceChildren();
  for (let index = 0; index < 42; index++) {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const value = cardDateString(date);
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = date.getDate();
    button.className = [date.getMonth() !== month.getMonth() ? 'outside-month' : '', value === today ? 'is-today' : '', value === selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    button.setAttribute('aria-label', date.toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}));
    button.setAttribute('aria-pressed', String(value === selected));
    if (value === today) button.setAttribute('aria-current', 'date');
    button.addEventListener('click', () => {
      const kind = state.calendarTarget;
      $(`datePicker${kind}`).value = value;
      $(`date${kind}Enabled`).checked = true;
      $(`datePicker${kind}`).disabled = false;
      if (kind === 'Due') $('datePickerTime').disabled = false;
      renderDateCalendar();
    });
    grid.append(button);
  }
}

function saveCardDates(remove) {
  const card = currentModalCard();
  if (!card) return;
  const startDate = !remove && $('dateStartEnabled').checked ? $('datePickerStart').value : '';
  const dueDate = !remove && $('dateDueEnabled').checked ? $('datePickerDue').value : '';
  if ((!remove && $('dateStartEnabled').checked && !parseCardDate(startDate)) || (!remove && $('dateDueEnabled').checked && !parseCardDate(dueDate)) || (startDate && dueDate && startDate > dueDate)) {
    $('datePickerError').textContent = 'Choose valid dates. Start date must be on or before the due date.';
    $('datePickerError').hidden = false;
    return;
  }
  card.startDate = startDate;
  card.dueDate = dueDate;
  card.dueTime = dueDate ? ($('datePickerTime').value || '09:00') : '';
  card.recurring = dueDate ? $('datePickerRecurring').value : 'never';
  card.reminder = dueDate ? $('datePickerReminder').value : 'none';
  card.updatedAt = Date.now();
  card.reminderShown = '';
  $('cardDueDate').value = dueDate;
  updateCardDateSummary(card);
  saveState(); renderBoardContent(); closeCardDates();
  showToast(remove ? 'Dates removed' : 'Dates saved', 'success');
}

function checkCardReminders() {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  for (const board of state.boards) {
    for (const column of board.columns) {
      for (const card of column.cards) {
        if (!card.dueDate || card.completed || card.reminder == null || card.reminder === 'none') continue;
        const due = new Date(`${card.dueDate}T${card.dueTime || '09:00'}`).getTime();
        const minutes = Number(card.reminder);
        if (!Number.isFinite(due) || ![0, 5, 60, 1440].includes(minutes)) continue;
        const key = `${card.dueDate}/${card.dueTime}/${card.reminder}`;
        if (now >= due - minutes * 60000 && now <= due + 86400000 && card.reminderShown !== key) {
          card.reminderShown = key;
          saveState();
          showToast(`Reminder: ${card.title} · due ${card.dueDate} ${card.dueTime || '09:00'}`);
          return;
        }
      }
    }
  }
}

function renderCustomFields() {
  const container = $('cardCustomFields');
  container.replaceChildren();
  state.draftCustomFields.forEach(field => {
    const row = document.createElement('div');
    row.className = 'custom-field-row';
    const name = document.createElement('input');
    name.className = 'input'; name.value = field.name; name.maxLength = 60;
    name.placeholder = 'Field name'; name.setAttribute('aria-label', 'Custom field name');
    name.addEventListener('input', () => { field.name = name.value; });
    const value = document.createElement('input');
    value.className = 'input'; value.value = field.value; value.maxLength = 500;
    value.placeholder = 'Value'; value.setAttribute('aria-label', 'Custom field value');
    value.addEventListener('input', () => { field.value = value.value; });
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'btn-ghost'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${field.name || 'custom field'}`);
    remove.addEventListener('click', () => { state.draftCustomFields = state.draftCustomFields.filter(item => item.id !== field.id); renderCustomFields(); });
    row.append(name, value, remove);
    container.append(row);
  });
}

function renderCardActivity(card) {
  const container = $('cardComments');
  container.replaceChildren();
  (card.comments || []).slice().reverse().forEach(comment => {
    const row = document.createElement('article');
    row.className = 'trello-comment';
    const avatar = document.createElement('span');
    avatar.className = 'comment-avatar';
    avatar.textContent = 'E';
    const content = document.createElement('div');
    const author = document.createElement('strong');
    author.textContent = 'You';
    const date = document.createElement('time');
    date.dateTime = new Date(comment.createdAt).toISOString();
    date.textContent = new Date(comment.createdAt).toLocaleString();
    const message = document.createElement('p');
    message.dir = 'auto';
    message.textContent = comment.text;
    content.append(author, date, message);
    row.append(avatar, content);
    container.append(row);
  });
  const dates = [];
  if (card.createdAt) dates.push('Created ' + new Date(card.createdAt).toLocaleString());
  if (card.updatedAt) dates.push('Last updated ' + new Date(card.updatedAt).toLocaleString());
  $('cardActivityDetails').textContent = dates.join('\n') || 'No earlier activity recorded.';
}

function saveCardComment() {
  const {boardId, columnId, cardId} = state.cardModal;
  const card = getColumn(boardId, columnId)?.cards.find(item => item.id === cardId);
  const text = $('cardComment').value.trim();
  if (!card || !text) return;
  card.comments = [...(card.comments || []), {id: crypto.randomUUID(), text, createdAt: Date.now()}];
  saveState();
  renderCardActivity(card);
  $('cardComment').value = '';
  $('saveCommentBtn').hidden = true;
  showToast('Comment saved', 'success');
}

function deleteCurrentCard() {
  const { boardId, columnId, cardId } = state.cardModal;
  if (!boardId || !columnId || !cardId) return;
  const board = getBoard(boardId);
  if (!board) return;
  const column = board.columns.find(c => c.id === columnId);
  if (!column) return;
  if (!confirm(`Delete card "${column.cards.find(c => c.id === cardId)?.title || ''}"?`)) return;
  column.cards = column.cards.filter(c => c.id !== cardId);
  saveState();
  render();
  closeCardModal();
  showToast('Card deleted', 'success');
}
