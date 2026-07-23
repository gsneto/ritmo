const legacyStateKey = "ritmo-habits-v2";
const legacyStorageKey = "ritmo-habits-v1";
const activeProfileKey = "ritmo-active-profile";
const starterResetVersion = 1;
const themeKey = "ritmo-theme";
const profiles = [
  { id: "antonio", name: "Antonio", initials: "A" },
  { id: "itayna", name: "Itayna", initials: "I" }
];
const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

let activeProfileId = getActiveProfileId();
let state = loadState(activeProfileId);
let activeTheme = getTheme();
let activeView = "today";
let activeTaskFilter = "all";
let editingWorkoutIndex = null;
const pomodoro = { habitId: null, phase: "focus", remaining: 25 * 60, cycles: 0, timerId: null, isRunning: false };

const entryForm = document.querySelector("#entryForm");
const entryType = document.querySelector("#entryType");
const entryTitle = document.querySelector("#entryTitle");
const entryName = document.querySelector("#entryName");
const entryDate = document.querySelector("#entryDate");
const entryDateField = document.querySelector("#entryDateField");
const entryTime = document.querySelector("#entryTime");
const entrySubmit = document.querySelector("#entrySubmit");
const habitList = document.querySelector("#habitList");
const todayHabitList = document.querySelector("#todayHabitList");
const todayTasks = document.querySelector("#todayTasks");
const taskList = document.querySelector("#taskList");
const workoutPanel = document.querySelector("#workoutPanel");
const workoutList = document.querySelector("#workoutList");
const focusHabitSelect = document.querySelector("#focusHabitSelect");
const pomodoroPanel = document.querySelector("#pomodoroPanel");
const focusEmpty = document.querySelector("#focusEmpty");
const pomodoroHabitName = document.querySelector("#pomodoroHabitName");
const pomodoroCycle = document.querySelector("#pomodoroCycle");
const pomodoroClock = document.querySelector("#pomodoroClock");
const pomodoroPhase = document.querySelector("#pomodoroPhase");
const pomodoroDescription = document.querySelector("#pomodoroDescription");
const pomodoroStart = document.querySelector("#pomodoroStart");
const pomodoroReset = document.querySelector("#pomodoroReset");
const monthlyChart = document.querySelector("#monthlyChart");
const weekHistory = document.querySelector("#weekHistory");
const historyList = document.querySelector("#historyList");
const todayProgress = document.querySelector("#todayProgress");
const monthProgress = document.querySelector("#monthProgress");
const streakValue = document.querySelector("#streakValue");
const checkedCount = document.querySelector("#checkedCount");
const todayTitle = document.querySelector("#todayTitle");
const todaySubtitle = document.querySelector("#todaySubtitle");
const profileButton = document.querySelector("#profileButton");
const activeProfileName = document.querySelector("#activeProfileName");
const activeProfileInitials = document.querySelector("#activeProfileInitials");
const profileCards = document.querySelector("#profileCards");
const resetProfileTitle = document.querySelector("#resetProfileTitle");

entryForm.addEventListener("submit", handleEntrySubmit);
document.querySelectorAll("[data-entry-type]").forEach((button) => {
  button.addEventListener("click", () => setEntryType(button.dataset.entryType));
});
document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewTarget));
});
document.querySelectorAll("[data-task-filter]").forEach((button) => {
  button.addEventListener("click", () => setTaskFilter(button.dataset.taskFilter));
});
document.querySelector("#newTaskButton").addEventListener("click", () => {
  setView("habits");
  setEntryType("task");
  entryName.focus();
});
document.querySelector("#resetButton").addEventListener("click", resetApp);
profileButton.addEventListener("click", () => setView("settings"));
document.querySelectorAll("[data-theme-option]").forEach((button) => {
  button.addEventListener("click", () => setTheme(button.dataset.themeOption));
});
document.querySelector("#closeWorkouts").addEventListener("click", () => {
  workoutPanel.hidden = true;
});
pomodoroStart.addEventListener("click", togglePomodoro);
pomodoroReset.addEventListener("click", resetPomodoro);
focusHabitSelect.addEventListener("change", () => selectPomodoro(focusHabitSelect.value, false));

saveState();
applyTheme(activeTheme);
render();

function getActiveProfileId() {
  const savedProfile = localStorage.getItem(activeProfileKey);
  return profiles.some((profile) => profile.id === savedProfile) ? savedProfile : "antonio";
}

function profileStorageKey(profileId) {
  return `ritmo-profile-${profileId}-v1`;
}

function activeProfile() {
  return profiles.find((profile) => profile.id === activeProfileId) || profiles[0];
}

function getTheme() {
  return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  activeTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = activeTheme;
  localStorage.setItem(themeKey, activeTheme);
}

function setTheme(theme) {
  applyTheme(theme);
  renderTheme();
}

function loadState(profileId) {
  const raw = localStorage.getItem(profileStorageKey(profileId))
    || (profileId === "antonio" ? localStorage.getItem(legacyStateKey) || localStorage.getItem(legacyStorageKey) : null);
  if (!raw) {
    return createSeedState();
  }

  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return createSeedState();
  }
}

function createSeedState() {
  return {
    habits: [],
    tasks: [],
    weeklyWorkouts: defaultWorkouts(),
    starterResetVersion
  };
}

function normalizeState(raw) {
  const today = localDate();
  const habits = [];
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask).filter(Boolean) : [];

  if (Array.isArray(raw.habits)) {
    for (const item of raw.habits) {
      if (item.type === "task") {
        const task = normalizeTask(item);
        if (task) tasks.push(task);
        continue;
      }
      if (!item || !item.name) continue;
      const checkIns = Array.isArray(item.checkIns)
        ? item.checkIns.filter(isDateKey)
        : item.doneToday ? [today] : [];
      habits.push({
        id: item.id || createId(),
        name: String(item.name),
        time: isTime(item.time) ? item.time : "09:00",
        createdAt: isDateKey(item.createdAt) ? item.createdAt : today,
        checkIns: [...new Set(checkIns)]
      });
    }
  }

  const normalized = {
    habits,
    tasks: uniqueTasks(tasks),
    weeklyWorkouts: normalizeWorkouts(raw.weeklyWorkouts),
    starterResetVersion: Number(raw.starterResetVersion) || 0
  };

  return normalized.starterResetVersion < starterResetVersion
    ? { ...normalized, habits: [], tasks: [], starterResetVersion }
    : normalized;
}

function normalizeTask(task) {
  if (!task || !task.name || !isDateKey(task.date)) return null;
  return {
    id: task.id || createId(),
    name: String(task.name),
    date: task.date,
    time: isTime(task.time) ? task.time : "09:00",
    completedAt: task.completedAt || (task.doneToday ? `${task.date}T${task.time}` : null),
    createdAt: isDateKey(task.createdAt) ? task.createdAt : localDate()
  };
}

function uniqueTasks(tasks) {
  const seen = new Set();
  return tasks.filter((task) => {
    if (!task || seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

function defaultWorkouts() {
  return [
    { day: "Seg", title: "Peito e triceps", note: "", exercises: [{ name: "Supino reto", sets: "3", reps: "10" }, { name: "Crucifixo", sets: "3", reps: "12" }] },
    { day: "Ter", title: "Costas e biceps", note: "", exercises: [{ name: "Puxada frontal", sets: "3", reps: "10" }, { name: "Remada", sets: "3", reps: "12" }] },
    { day: "Qua", title: "Pernas", note: "", exercises: [{ name: "Agachamento", sets: "3", reps: "10" }, { name: "Leg press", sets: "3", reps: "12" }] },
    { day: "Qui", title: "Ombros e abdomen", note: "", exercises: [{ name: "Desenvolvimento", sets: "3", reps: "10" }, { name: "Prancha", sets: "3", reps: "40s" }] },
    { day: "Sex", title: "Corpo todo", note: "", exercises: [{ name: "Circuito livre", sets: "3", reps: "12" }] },
    { day: "Sab", title: "Descanso ativo", note: "Caminhada ou mobilidade", exercises: [] },
    { day: "Dom", title: "Descanso", note: "Recuperacao", exercises: [] }
  ];
}

function normalizeWorkouts(workouts) {
  const defaults = defaultWorkouts();
  if (!Array.isArray(workouts)) return defaults;
  return defaults.map((fallback, index) => {
    const workout = workouts[index];
    if (!workout) return fallback;
    return {
      day: fallback.day,
      title: String(workout.title || fallback.title),
      note: String(workout.note || ""),
      exercises: Array.isArray(workout.exercises)
        ? workout.exercises.filter((exercise) => exercise && exercise.name).map((exercise) => ({
            name: String(exercise.name),
            sets: String(exercise.sets || ""),
            reps: String(exercise.reps || "")
          }))
        : fallback.exercises
    };
  });
}

function saveState() {
  localStorage.setItem(profileStorageKey(activeProfileId), JSON.stringify(state));
  localStorage.setItem(activeProfileKey, activeProfileId);
}

function switchProfile(profileId) {
  if (profileId === activeProfileId || !profiles.some((profile) => profile.id === profileId)) return;
  stopPomodoro();
  activeProfileId = profileId;
  state = loadState(activeProfileId);
  activeTaskFilter = "all";
  editingWorkoutIndex = null;
  workoutPanel.hidden = true;
  setEntryType("habit");
  saveState();
  render();
  setView("today");
}

function handleEntrySubmit(event) {
  event.preventDefault();
  const type = entryType.value;
  const name = entryName.value.trim();
  const time = entryTime.value;
  if (!name || !isTime(time) || (type === "task" && !isDateKey(entryDate.value))) return;

  if (type === "task") {
    state.tasks.unshift({ id: createId(), name, date: entryDate.value, time, completedAt: null, createdAt: localDate() });
    setView("tasks");
  } else {
    state.habits.unshift({ id: createId(), name, time, createdAt: localDate(), checkIns: [] });
  }

  entryName.value = "";
  entryTime.value = "";
  entryDate.value = "";
  saveState();
  render();
}

function setEntryType(type) {
  const isTask = type === "task";
  entryType.value = type;
  entryTitle.textContent = isTask ? "Nova tarefa" : "Novo habito";
  entryDateField.hidden = !isTask;
  entryDate.required = isTask;
  entrySubmit.textContent = isTask ? "Adicionar tarefa" : "Adicionar habito";
  entryName.placeholder = isTask ? "Ex: Prova de matematica" : "Ex: Caminhar 20 minutos";
  document.querySelectorAll("[data-entry-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.entryType === type);
  });
}

function setView(view) {
  const previousView = activeView;
  activeView = view;
  document.querySelectorAll("[data-view]").forEach((element) => {
    element.hidden = element.dataset.view !== view;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
  if (view === "habits" && previousView !== "habits") setEntryType("habit");
  if (view === "focus") renderFocus();
  if (view === "progress") renderProgress();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function toggleHabitCheckIn(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit) return;
  const today = localDate();
  habit.checkIns = habit.checkIns.includes(today)
    ? habit.checkIns.filter((date) => date !== today)
    : [...habit.checkIns, today].sort();
  saveState();
  render();
}

function toggleTaskCompletion(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.completedAt = task.completedAt ? null : new Date().toISOString();
  saveState();
  render();
}

function removeHabit(id) {
  const habit = state.habits.find((item) => item.id === id);
  if (!habit || !window.confirm(`Remover o habito "${habit.name}"?`)) return;
  state.habits = state.habits.filter((item) => item.id !== id);
  saveState();
  render();
}

function removeTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !window.confirm(`Remover a tarefa "${task.name}"?`)) return;
  state.tasks = state.tasks.filter((item) => item.id !== id);
  saveState();
  render();
}

function render() {
  renderToday();
  renderHabits();
  renderTasks();
  renderFocus();
  renderWorkouts();
  renderProgress();
  renderProfiles();
  renderTheme();
  refreshIcons();
}

function renderTheme() {
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeOption === activeTheme);
  });
}

function renderProfiles() {
  const profile = activeProfile();
  activeProfileName.textContent = profile.name;
  activeProfileInitials.textContent = profile.initials;
  resetProfileTitle.textContent = `Dados de ${profile.name}`;
  profileCards.innerHTML = "";

  for (const item of profiles) {
    const card = document.createElement("article");
    card.className = `profile-card ${item.id === activeProfileId ? "active-profile" : ""}`;
    card.innerHTML = `<span class="profile-avatar">${item.initials}</span><div><strong>${item.name}</strong><small>${item.id === activeProfileId ? "Perfil ativo" : ""}</small></div>`;
    const button = makeButton(item.id === activeProfileId ? "Em uso" : "Usar perfil", item.id === activeProfileId ? "profile-current-button" : "profile-switch-button", () => switchProfile(item.id));
    button.disabled = item.id === activeProfileId;
    card.appendChild(button);
    profileCards.appendChild(card);
  }
}

function renderToday() {
  const today = localDate();
  const habits = activeHabitsOn(today).sort(sortHabitsByTime);
  const done = habits.filter((habit) => hasCheckIn(habit, today)).length;
  const rate = habits.length ? Math.round((done / habits.length) * 100) : 0;
  const month = monthSummary(new Date());

  todayProgress.textContent = `${rate}%`;
  monthProgress.textContent = `${month.score}%`;
  streakValue.textContent = `${calculateStreak()} dias`;
  checkedCount.textContent = `${done} de ${habits.length} feitos`;
  todayTitle.textContent = done ? "Voce ja comecou bem hoje" : "Comece com um check-in";
  todaySubtitle.textContent = done ? "Cada check-in fica registrado no seu historico." : "Marque o primeiro habito do seu dia.";

  todayHabitList.innerHTML = "";
  if (!habits.length) {
    todayHabitList.innerHTML = '<p class="empty-state">Nenhum habito ativo.</p>';
  } else {
    habits.forEach((habit) => todayHabitList.appendChild(createHabitRow(habit, false)));
  }

  const todaysTasks = state.tasks.filter((task) => task.date === today && !task.completedAt);
  todayTasks.innerHTML = "";
  if (!todaysTasks.length) {
    todayTasks.innerHTML = '<p class="empty-state">Nenhuma tarefa para hoje.</p>';
  } else {
    todaysTasks.forEach((task) => todayTasks.appendChild(createTodayTask(task)));
  }
}

function renderHabits() {
  habitList.innerHTML = "";
  if (!state.habits.length) {
    habitList.innerHTML = '<p class="empty-state">Nenhum habito cadastrado.</p>';
    return;
  }
  [...state.habits].sort(sortHabitsByTime).forEach((habit) => habitList.appendChild(createHabitRow(habit, true)));
}

function createHabitRow(habit, managed) {
  const today = localDate();
  const row = document.createElement("article");
  row.className = "habit-item";
  row.innerHTML = `<div class="habit-details"><strong>${escapeHtml(habit.name)}</strong><small>${formatTime(habit.time)}${hasCheckIn(habit, today) ? " · feito hoje" : ""}</small></div>`;
  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (isReadingHabit(habit)) {
    const focusButton = makeButton("Foco", "focus-button", () => selectPomodoro(habit.id, true));
    actions.appendChild(focusButton);
  }
  if (isWorkoutHabit(habit)) {
    const workoutsButton = makeButton("Treinos", "workout-button", showWorkouts);
    actions.appendChild(workoutsButton);
  }

  const checkButton = makeButton(hasCheckIn(habit, today) ? "Feito" : "Marcar", `check-button ${hasCheckIn(habit, today) ? "done" : ""}`, () => toggleHabitCheckIn(habit.id));
  actions.appendChild(checkButton);

  if (managed) {
    actions.append(
      makeIconButton("pencil", `Editar ${habit.name}`, () => showHabitEditor(habit, row)),
      makeIconButton("trash-2", `Remover ${habit.name}`, () => removeHabit(habit.id), "danger-button")
    );
  }
  row.appendChild(actions);
  return row;
}

function showHabitEditor(habit, row) {
  if (row.querySelector(".inline-editor")) return;
  const form = document.createElement("form");
  form.className = "inline-editor";
  form.innerHTML = `
    <label>Nome<input name="name" maxlength="60" value="${escapeHtml(habit.name)}" required /></label>
    <label>Horario<input name="time" type="time" value="${escapeHtml(habit.time)}" required /></label>
    <div class="editor-actions"><button class="primary-button" type="submit">Salvar</button><button class="ghost-button" type="button">Cancelar</button></div>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const time = String(data.get("time"));
    if (!name || !isTime(time)) return;
    habit.name = name;
    habit.time = time;
    saveState();
    render();
  });
  form.querySelector(".ghost-button").addEventListener("click", () => form.remove());
  row.appendChild(form);
  form.querySelector("input").focus();
}

function renderTasks() {
  taskList.innerHTML = "";
  const tasks = state.tasks
    .filter((task) => activeTaskFilter === "all" || taskStatus(task) === activeTaskFilter)
    .sort(sortTasks);

  document.querySelectorAll("[data-task-filter]").forEach((button) => {
    const filter = button.dataset.taskFilter;
    const count = filter === "all" ? state.tasks.length : state.tasks.filter((task) => taskStatus(task) === filter).length;
    button.classList.toggle("active", filter === activeTaskFilter);
    button.textContent = `${taskFilterLabel(filter)} (${count})`;
  });

  if (!tasks.length) {
    taskList.innerHTML = '<p class="empty-state">Nenhuma tarefa nesta lista.</p>';
    return;
  }
  tasks.forEach((task) => taskList.appendChild(createTaskRow(task)));
}

function createTodayTask(task) {
  const item = document.createElement("article");
  item.className = "today-task";
  item.innerHTML = `<div><strong>${escapeHtml(task.name)}</strong><small>${formatTime(task.time)}</small></div>`;
  item.appendChild(makeButton("Concluir", "check-button", () => toggleTaskCompletion(task.id)));
  return item;
}

function createTaskRow(task) {
  const row = document.createElement("article");
  const status = taskStatus(task);
  row.className = `task-item task-${status}`;
  row.innerHTML = `<div class="task-details"><div class="task-heading"><strong>${escapeHtml(task.name)}</strong><span class="status-chip ${status}">${taskStatusLabel(status)}</span></div><small>${formatDate(task.date)} as ${formatTime(task.time)}</small></div>`;
  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.append(
    makeButton(status === "completed" ? "Reabrir" : "Concluir", `check-button ${status === "completed" ? "done" : ""}`, () => toggleTaskCompletion(task.id)),
    makeIconButton("pencil", `Editar ${task.name}`, () => showTaskEditor(task, row)),
    makeIconButton("trash-2", `Remover ${task.name}`, () => removeTask(task.id), "danger-button")
  );
  row.appendChild(actions);
  return row;
}

function showTaskEditor(task, row) {
  if (row.querySelector(".inline-editor")) return;
  const form = document.createElement("form");
  form.className = "inline-editor task-editor";
  form.innerHTML = `
    <label>Nome<input name="name" maxlength="60" value="${escapeHtml(task.name)}" required /></label>
    <label>Data<input name="date" type="date" value="${escapeHtml(task.date)}" required /></label>
    <label>Horario<input name="time" type="time" value="${escapeHtml(task.time)}" required /></label>
    <div class="editor-actions"><button class="primary-button" type="submit">Salvar</button><button class="ghost-button" type="button">Cancelar</button></div>
  `;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name")).trim();
    const date = String(data.get("date"));
    const time = String(data.get("time"));
    if (!name || !isDateKey(date) || !isTime(time)) return;
    task.name = name;
    task.date = date;
    task.time = time;
    saveState();
    render();
  });
  form.querySelector(".ghost-button").addEventListener("click", () => form.remove());
  row.appendChild(form);
  form.querySelector("input").focus();
}

function setTaskFilter(filter) {
  activeTaskFilter = filter;
  renderTasks();
  refreshIcons();
}

function taskStatus(task) {
  if (task.completedAt) return "completed";
  const due = new Date(`${task.date}T${task.time || "23:59"}`);
  return due.getTime() < Date.now() ? "overdue" : "pending";
}

function taskStatusLabel(status) {
  return { pending: "Pendente", overdue: "Atrasada", completed: "Concluida" }[status];
}

function taskFilterLabel(filter) {
  return { all: "Todas", pending: "Pendentes", overdue: "Atrasadas", completed: "Concluidas" }[filter];
}

function sortTasks(first, second) {
  const priority = { overdue: 0, pending: 1, completed: 2 };
  const statusDifference = priority[taskStatus(first)] - priority[taskStatus(second)];
  if (statusDifference) return statusDifference;
  return `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`);
}

function sortHabitsByTime(first, second) {
  return first.time.localeCompare(second.time) || first.name.localeCompare(second.name);
}

function showWorkouts() {
  setView("habits");
  workoutPanel.hidden = false;
  renderWorkouts();
  refreshIcons();
  window.setTimeout(() => workoutPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

function renderWorkouts() {
  workoutList.innerHTML = "";
  const currentIndex = todayWorkoutIndex();
  state.weeklyWorkouts.forEach((workout, index) => {
    const card = document.createElement("article");
    card.className = `workout-day ${index === currentIndex ? "today-workout" : ""}`;
    card.innerHTML = `
      <div class="workout-card-head"><span>${workout.day}</span><button class="icon-button small-icon" type="button" title="Editar ${workout.day}" aria-label="Editar ${workout.day}"><i data-lucide="pencil"></i></button></div>
      <h3>${escapeHtml(workout.title)}</h3>
      <div class="exercise-summary">${workout.exercises.length ? workout.exercises.map((exercise) => `<p><strong>${escapeHtml(exercise.name)}</strong><small>${escapeHtml(exercise.sets)} x ${escapeHtml(exercise.reps)}</small></p>`).join("") : "<p class=\"tiny-note\">Sem exercicios</p>"}</div>
      ${workout.note ? `<p class="workout-note">${escapeHtml(workout.note)}</p>` : ""}
    `;
    card.querySelector(".icon-button").addEventListener("click", () => showWorkoutEditor(index, card));
    if (editingWorkoutIndex === index) showWorkoutEditor(index, card);
    workoutList.appendChild(card);
  });
}

function showWorkoutEditor(index, card) {
  if (card.querySelector(".workout-editor")) return;
  editingWorkoutIndex = index;
  const workout = state.weeklyWorkouts[index];
  const form = document.createElement("form");
  form.className = "workout-editor";
  form.innerHTML = `
    <label>Treino do dia<input name="title" maxlength="60" value="${escapeHtml(workout.title)}" required /></label>
    <div class="exercise-editor-list"></div>
    <button class="add-exercise-button" type="button"><i data-lucide="plus"></i><span>Exercicio</span></button>
    <label>Observacao<textarea name="note" maxlength="160" rows="2">${escapeHtml(workout.note)}</textarea></label>
    <div class="editor-actions"><button class="primary-button" type="submit">Salvar</button><button class="ghost-button" type="button">Cancelar</button></div>
  `;
  const exerciseList = form.querySelector(".exercise-editor-list");
  const addExercise = (exercise = { name: "", sets: "3", reps: "10" }) => {
    const item = document.createElement("div");
    item.className = "exercise-editor-row";
    item.innerHTML = `<input data-exercise="name" placeholder="Exercicio" maxlength="50" value="${escapeHtml(exercise.name)}" /><input data-exercise="sets" inputmode="numeric" placeholder="Series" maxlength="4" value="${escapeHtml(exercise.sets)}" /><input data-exercise="reps" placeholder="Reps" maxlength="8" value="${escapeHtml(exercise.reps)}" /><button type="button" class="icon-button small-icon" title="Remover exercicio" aria-label="Remover exercicio"><i data-lucide="x"></i></button>`;
    item.querySelector("button").addEventListener("click", () => item.remove());
    exerciseList.appendChild(item);
  };
  workout.exercises.forEach(addExercise);
  form.querySelector(".add-exercise-button").addEventListener("click", () => {
    addExercise();
    refreshIcons();
  });
  form.querySelector(".ghost-button").addEventListener("click", () => {
    editingWorkoutIndex = null;
    renderWorkouts();
    refreshIcons();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = String(new FormData(form).get("title")).trim();
    if (!title) return;
    const exercises = [...form.querySelectorAll(".exercise-editor-row")]
      .map((item) => ({
        name: item.querySelector('[data-exercise="name"]').value.trim(),
        sets: item.querySelector('[data-exercise="sets"]').value.trim(),
        reps: item.querySelector('[data-exercise="reps"]').value.trim()
      }))
      .filter((exercise) => exercise.name);
    state.weeklyWorkouts[index] = { ...workout, title, exercises, note: String(new FormData(form).get("note")).trim() };
    editingWorkoutIndex = null;
    saveState();
    renderWorkouts();
    refreshIcons();
  });
  card.appendChild(form);
  refreshIcons();
}

function renderFocus() {
  const readingHabits = state.habits.filter(isReadingHabit);
  if (!readingHabits.some((habit) => habit.id === pomodoro.habitId)) {
    stopPomodoro();
    pomodoro.habitId = readingHabits[0]?.id || null;
    pomodoro.phase = "focus";
    pomodoro.remaining = 25 * 60;
    pomodoro.cycles = 0;
  }
  focusHabitSelect.innerHTML = readingHabits.map((habit) => `<option value="${escapeHtml(habit.id)}">${escapeHtml(habit.name)}</option>`).join("");
  focusHabitSelect.value = pomodoro.habitId || "";
  pomodoroPanel.hidden = !pomodoro.habitId;
  focusEmpty.hidden = Boolean(pomodoro.habitId);
  if (!pomodoro.habitId) return;

  const habit = state.habits.find((item) => item.id === pomodoro.habitId);
  const minutes = String(Math.floor(pomodoro.remaining / 60)).padStart(2, "0");
  const seconds = String(pomodoro.remaining % 60).padStart(2, "0");
  const isFocus = pomodoro.phase === "focus";
  const breakMinutes = pomodoro.cycles > 0 && pomodoro.cycles % 4 === 0 ? 15 : 5;
  pomodoroClock.textContent = `${minutes}:${seconds}`;
  pomodoroPhase.textContent = isFocus ? "Foco" : "Pausa";
  pomodoroHabitName.textContent = habit.name;
  pomodoroCycle.textContent = `Ciclo ${pomodoro.cycles + 1}`;
  pomodoroDescription.textContent = isFocus ? "25 minutos para ler sem interrupcoes." : `${breakMinutes} minutos de pausa antes do proximo foco.`;
  pomodoroStart.textContent = pomodoro.isRunning ? "Pausar" : isFocus ? "Iniciar foco" : "Iniciar pausa";
}

function selectPomodoro(id, changeView) {
  if (!id) return;
  if (pomodoro.habitId !== id) {
    stopPomodoro();
    pomodoro.habitId = id;
    pomodoro.phase = "focus";
    pomodoro.remaining = 25 * 60;
    pomodoro.cycles = 0;
  }
  if (changeView) setView("focus");
  renderFocus();
}

function togglePomodoro() {
  if (!pomodoro.habitId) return;
  if (pomodoro.isRunning) {
    stopPomodoro();
  } else {
    pomodoro.isRunning = true;
    pomodoro.timerId = window.setInterval(tickPomodoro, 1000);
  }
  renderFocus();
}

function stopPomodoro() {
  if (pomodoro.timerId) window.clearInterval(pomodoro.timerId);
  pomodoro.timerId = null;
  pomodoro.isRunning = false;
}

function resetPomodoro() {
  stopPomodoro();
  pomodoro.phase = "focus";
  pomodoro.remaining = 25 * 60;
  renderFocus();
}

function tickPomodoro() {
  pomodoro.remaining -= 1;
  if (pomodoro.remaining <= 0) finishPomodoroPhase();
  renderFocus();
}

function finishPomodoroPhase() {
  if (pomodoro.phase === "focus") {
    pomodoro.cycles += 1;
    const habit = state.habits.find((item) => item.id === pomodoro.habitId);
    if (habit && !hasCheckIn(habit, localDate())) {
      habit.checkIns.push(localDate());
      saveState();
      renderToday();
      renderHabits();
      renderProgress();
      refreshIcons();
    }
    pomodoro.phase = "break";
    pomodoro.remaining = pomodoro.cycles % 4 === 0 ? 15 * 60 : 5 * 60;
  } else {
    pomodoro.phase = "focus";
    pomodoro.remaining = 25 * 60;
  }
}

function renderProgress() {
  renderMonthlyChart();
  renderWeekHistory();
  const month = monthSummary(new Date());
  const totalChecks = state.habits.reduce((sum, habit) => sum + habit.checkIns.length, 0);
  const cards = [
    { label: "Consistencia do mes", value: `${month.score}%` },
    { label: "Sequencia atual", value: `${calculateStreak()} dias` },
    { label: "Check-ins registrados", value: `${totalChecks}` }
  ];
  historyList.innerHTML = cards.map((card) => `<article class="history-card"><p class="tiny-note">${card.label}</p><strong>${card.value}</strong></article>`).join("");
}

function renderMonthlyChart() {
  monthlyChart.innerHTML = "";
  const current = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - offset, 1);
    const summary = monthSummary(date);
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `<span>${monthNames[date.getMonth()]}</span><div class="bar-track"><div class="bar-fill" style="width:${summary.score}%"></div></div><strong>${summary.score}%</strong>`;
    monthlyChart.appendChild(row);
  }
}

function renderWeekHistory() {
  weekHistory.innerHTML = "";
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = dateOffset(-offset);
    const habits = activeHabitsOn(date);
    const done = habits.filter((habit) => hasCheckIn(habit, date)).length;
    const percent = habits.length ? Math.round((done / habits.length) * 100) : 0;
    const item = document.createElement("article");
    item.className = "day-history";
    item.innerHTML = `<span>${formatWeekday(date)}</span><strong>${percent}%</strong><small>${done}/${habits.length}</small>`;
    weekHistory.appendChild(item);
  }
}

function monthSummary(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const current = new Date();
  const lastDay = year === current.getFullYear() && month === current.getMonth()
    ? current.getDate()
    : new Date(year, month + 1, 0).getDate();
  let available = 0;
  let completed = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const key = dateKey(year, month + 1, day);
    const habits = activeHabitsOn(key);
    available += habits.length;
    completed += habits.filter((habit) => hasCheckIn(habit, key)).length;
  }
  return { score: available ? Math.round((completed / available) * 100) : 0, available, completed };
}

function calculateStreak() {
  let streak = 0;
  for (let offset = 0; offset < 366; offset += 1) {
    const date = dateOffset(-offset);
    const habits = activeHabitsOn(date);
    if (!habits.length || !habits.every((habit) => hasCheckIn(habit, date))) break;
    streak += 1;
  }
  return streak;
}

function activeHabitsOn(date) {
  return state.habits.filter((habit) => habit.createdAt <= date);
}

function hasCheckIn(habit, date) {
  return habit.checkIns.includes(date);
}

function todayWorkoutIndex() {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function isReadingHabit(habit) {
  return /leitura|\bler\b/i.test(habit.name);
}

function isWorkoutHabit(habit) {
  return /treino/i.test(habit.name);
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function makeIconButton(icon, label, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${extraClass}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.addEventListener("click", onClick);
  return button;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function resetApp() {
  const profile = activeProfile();
  if (!window.confirm(`Limpar os dados de ${profile.name}?`)) return;
  state = createSeedState();
  activeTaskFilter = "all";
  editingWorkoutIndex = null;
  stopPomodoro();
  saveState();
  render();
  setView("today");
}

function createId() {
  return crypto.randomUUID();
}

function localDate() {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function dateOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function isTime(value) {
  return /^\d{2}:\d{2}$/.test(value || "");
}

function formatTime(value) {
  if (!isTime(value)) return "Sem horario";
  return value;
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatWeekday(value) {
  const [year, month, day] = value.split("-").map(Number);
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"][new Date(year, month - 1, day).getDay()];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
