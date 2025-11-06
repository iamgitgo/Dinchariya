/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import './index.css';

// --- DATA MODELS ---
type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface Subtask {
  id: string;
  name: string;
  subPoints?: number;
}

interface Task {
  id: string;
  name: string;
  points: number;
  timeStart?: string;
  timeEnd?: string;
  daysOfWeek: Day[];
  subtasks: Subtask[];
  active: boolean;
}

interface TaskInstance {
  id: string;
  task: Task;
  completed: boolean;
  subtaskCompletion: Record<string, boolean>;
}

const GOOGLE_SHEET_URL_KEY = 'dailyDinchariyaSheetUrl';

class DailyDinchariyaApp {
  private masterTasks: Task[] = [];
  private todayInstances: TaskInstance[] = [];

  // DOM Elements
  private taskListEl = document.getElementById('task-list')!;
  private pointsValueEl = document.getElementById('points-value')!;
  private streakValueEl = document.getElementById('streak-value')!;
  private progressCircleEl = document.getElementById('progress-circle')! as unknown as SVGCircleElement;
  private progressTextEl = document.getElementById('progress-text')!;
  private allDoneEl = document.getElementById('all-done')!;
  private progressRingRadius = 0;

  // Sheet Loader Elements
  private sheetUrlInputEl = document.getElementById('sheet-url-input')! as HTMLInputElement;
  private loadSheetBtnEl = document.getElementById('load-sheet-btn')! as HTMLButtonElement;
  private loaderStatusEl = document.getElementById('loader-status')!;

  constructor() {
    this.init();
  }

  private init() {
    this.progressRingRadius = this.progressCircleEl.r.baseVal.value;
    this.progressCircleEl.style.strokeDasharray = `${this.progressRingRadius * 2 * Math.PI} ${this.progressRingRadius * 2 * Math.PI}`;
    this.progressCircleEl.style.strokeDashoffset = `${this.progressRingRadius * 2 * Math.PI}`;
    
    this.setupEventListeners();
    this.loadInitialData();
  }
  
  private setupEventListeners() {
    this.loadSheetBtnEl.addEventListener('click', () => this.handleLoadSheetClick());
  }

  private loadInitialData() {
    const savedUrl = localStorage.getItem(GOOGLE_SHEET_URL_KEY);
    if (savedUrl) {
      this.sheetUrlInputEl.value = savedUrl;
      this.loadTasksFromUrl(savedUrl);
    }
  }

  private handleLoadSheetClick() {
    const url = this.sheetUrlInputEl.value.trim();
    if(url) {
      this.loadTasksFromUrl(url);
    }
  }

  private setLoaderState(message: string, isError: boolean = false, isLoading: boolean = false) {
    this.loaderStatusEl.textContent = message;
    this.loaderStatusEl.className = isError ? 'error' : 'success';
    this.loadSheetBtnEl.disabled = isLoading;
    if (isLoading) this.loadSheetBtnEl.textContent = 'Loading...';
    else this.loadSheetBtnEl.textContent = 'Load Tasks';
  }
  
  private getCsvUrl(url: string): string {
    // Case 1: Already a published CSV link (format: .../d/e/xxxx/pub?output=csv)
    if (url.includes('/pub?output=csv')) {
      return url;
    }

    // Case 2: Published HTML link, convert to CSV (format: .../d/e/xxxx/pubhtml)
    if (url.includes('/pubhtml')) {
      return url.replace('/pubhtml', '/pub?output=csv');
    }
    
    // Case 3: Standard sharing link (format: .../d/xxxx/edit)
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
        const sheetId = match[1];
        let gid = '0';
        const gidMatch = url.match(/gid=([0-9]+)/);
        if (gidMatch) {
            gid = gidMatch[1];
        }
        return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    }

    // If none of the above, throw an error
    throw new Error("Invalid or unsupported Google Sheet URL. Please use the 'Share' link or the 'Publish to web' CSV link.");
  }


  private async loadTasksFromUrl(sheetUrl: string) {
    this.setLoaderState('Loading tasks...', false, true);
    this.masterTasks = [];
    this.todayInstances = [];
    this.render(); // Clear the current view

    try {
      const csvUrl = this.getCsvUrl(sheetUrl);

      const response = await fetch(csvUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch data. Status: ${response.status}. Ensure the sheet is public ('Anyone with link') or published.`);
      }
      const csvData = await response.text();
      
      this.parseMasterTasks(csvData);
      this.generateTodayInstances();
      this.render();

      localStorage.setItem(GOOGLE_SHEET_URL_KEY, sheetUrl);
      this.setLoaderState(`Successfully loaded ${this.masterTasks.length} tasks!`, false, false);

    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      this.setLoaderState(`Error: ${errorMessage}`, true, false);
      localStorage.removeItem(GOOGLE_SHEET_URL_KEY); // Clear invalid URL
    }
  }
  
  private slug(s: string): string {
    return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  private parseMasterTasks(csv: string) {
    const lines = csv.split(/\r\n|\n/).slice(1); // Skip header, handle different line endings
    let currentTask: Task | null = null;
    
    lines.forEach(line => {
      if (!line.trim()) return; // Skip empty lines
      // Basic CSV parsing, doesn't handle commas in quoted fields perfectly but works for this app's data format.
      const columns = line.split(',').map(c => c.replace(/"/g, '').trim());
      const [taskName, subtaskName, points, subPoints, timeStart, timeEnd, daysOfWeek, , , , , activeStr] = columns;

      if (taskName) { // This is a parent task row
        const id = this.slug(taskName);
        const dayTokens = this.parseDays(daysOfWeek);

        currentTask = {
          id,
          name: taskName,
          points: parseInt(points, 10) || 0,
          timeStart: timeStart || undefined,
          timeEnd: timeEnd || undefined,
          daysOfWeek: dayTokens,
          subtasks: [],
          active: activeStr === 'TRUE'
        };
        this.masterTasks.push(currentTask);
      } else if (subtaskName && currentTask) { // This is a subtask row
        const subtaskId = this.slug(currentTask.name + "_" + subtaskName);
        currentTask.subtasks.push({
          id: subtaskId,
          name: subtaskName,
          subPoints: subPoints ? parseInt(subPoints, 10) : undefined,
        });
      }
    });
  }
  
  private parseDays(dayStr: string): Day[] {
      const allDays: Day[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      if (!dayStr || dayStr.toLowerCase() === 'all') return allDays;
      if (dayStr.toLowerCase() === 'weekdays') return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
      if (dayStr.toLowerCase() === 'weekend') return ['Sat', 'Sun'];
      return dayStr.split(',').map(s => s.trim() as Day).filter(d => allDays.includes(d));
  }

  private isEligibleToday(task: Task, today: Date): boolean {
    if (!task.active) return false;
    const dayMap: Day[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayDay = dayMap[today.getDay()];
    return task.daysOfWeek.includes(todayDay);
  }

  private generateTodayInstances() {
    const today = new Date();
    this.todayInstances = this.masterTasks
      .filter(task => this.isEligibleToday(task, today))
      .map(task => ({
        id: task.id,
        task,
        completed: false,
        subtaskCompletion: task.subtasks.reduce((acc, sub) => {
          acc[sub.id] = false;
          return acc;
        }, {} as Record<string, boolean>),
      }));
  }

  private updateProgress() {
    let currentPoints = 0;
    let totalPoints = 0;
    
    this.todayInstances.forEach(inst => {
      totalPoints += inst.task.points;
      if (inst.completed) {
        currentPoints += inst.task.points;
      } else if (inst.task.subtasks.length > 0) {
        const hasDefinedSubPoints = inst.task.subtasks.some(s => s.subPoints !== undefined);
        let earnedSubPoints = 0;
        
        if (hasDefinedSubPoints) {
          inst.task.subtasks.forEach(sub => {
            if (inst.subtaskCompletion[sub.id]) {
              earnedSubPoints += sub.subPoints || 0;
            }
          });
        } else {
          const completedCount = Object.values(inst.subtaskCompletion).filter(Boolean).length;
          if (inst.task.subtasks.length > 0) {
              const splitPoints = inst.task.points / inst.task.subtasks.length;
              earnedSubPoints = completedCount * splitPoints;
          }
        }
        currentPoints += Math.min(earnedSubPoints, inst.task.points);
      }
    });

    const progressPercent = totalPoints > 0 ? currentPoints / totalPoints : 0;
    const circumference = this.progressRingRadius * 2 * Math.PI;
    this.progressCircleEl.style.strokeDashoffset = `${circumference - progressPercent * circumference}`;
    this.progressTextEl.textContent = `${Math.round(progressPercent * 100)}%`;
    this.pointsValueEl.textContent = `${Math.round(currentPoints)} / ${totalPoints}`;
    
    if (this.todayInstances.length > 0 && progressPercent === 1) {
        this.allDoneEl.classList.remove('hidden');
    } else {
        this.allDoneEl.classList.add('hidden');
    }
  }

  private render() {
    this.taskListEl.innerHTML = '';
    if (this.todayInstances.length === 0 && this.masterTasks.length > 0) {
      // Handles case where sheet is loaded but no tasks are for today
      this.allDoneEl.classList.remove('hidden');
    } else {
      this.allDoneEl.classList.add('hidden');
      this.todayInstances.forEach(inst => {
        this.taskListEl.appendChild(this.createTaskElement(inst));
      });
    }
    this.updateProgress();
  }

  private createTaskElement(inst: TaskInstance): HTMLElement {
    const item = document.createElement('div');
    item.className = 'task-item';
    item.dataset.instanceId = inst.id;
    if (inst.completed) item.classList.add('completed');
    
    const hasSubtasks = inst.task.subtasks.length > 0;

    let timeWindow = '';
    if (inst.task.timeStart && inst.task.timeEnd) {
      timeWindow = `${inst.task.timeStart} - ${inst.task.timeEnd}`;
    }

    item.innerHTML = `
      <div class="task-header">
        <label class="checkbox-container">
          <input type="checkbox" ${inst.completed ? 'checked' : ''}>
          <span class="checkmark"></span>
        </label>
        <h2>${inst.task.name}</h2>
        <div class="task-meta">
          <span>${timeWindow}</span>
          <span class="points-pill">${inst.task.points} pts</span>
        </div>
      </div>
      ${hasSubtasks ? '<div class="subtask-list"></div>' : ''}
    `;

    // Event listener for task completion
    item.querySelector<HTMLInputElement>('input[type="checkbox"]')!.addEventListener('change', (e) => {
      this.handleTaskToggle(inst.id, (e.target as HTMLInputElement).checked);
    });

    // Render subtasks
    if (hasSubtasks) {
      const subtaskContainer = item.querySelector<HTMLElement>('.subtask-list')!;
      inst.task.subtasks.forEach(sub => {
        subtaskContainer.appendChild(this.createSubtaskElement(inst, sub));
      });
    }

    return item;
  }

  private createSubtaskElement(inst: TaskInstance, subtask: Subtask): HTMLElement {
    const subtaskItem = document.createElement('div');
    const isCompleted = inst.subtaskCompletion[subtask.id];
    subtaskItem.className = 'subtask-item';
    if(isCompleted) subtaskItem.classList.add('completed');
    subtaskItem.dataset.subtaskId = subtask.id;
    
    subtaskItem.innerHTML = `
      <label class="checkbox-container">
        <input type="checkbox" ${isCompleted ? 'checked' : ''}>
        <span class="checkmark"></span>
      </label>
      <p>${subtask.name}</p>
      ${subtask.subPoints ? `<span class="points-pill">${subtask.subPoints} pts</span>` : ''}
    `;
    
    subtaskItem.querySelector('input')!.addEventListener('change', (e) => {
      this.handleSubtaskToggle(inst.id, subtask.id, (e.target as HTMLInputElement).checked);
    });
    
    return subtaskItem;
  }
  
  private handleTaskToggle(instanceId: string, isChecked: boolean) {
    const inst = this.todayInstances.find(i => i.id === instanceId);
    if (!inst) return;
    
    inst.completed = isChecked;
    // If checking parent task, complete all subtasks. If unchecking, uncheck all.
    Object.keys(inst.subtaskCompletion).forEach(subId => {
        inst.subtaskCompletion[subId] = isChecked;
    });
    
    this.rerenderInstance(inst);
    this.updateProgress();
  }

  private handleSubtaskToggle(instanceId: string, subtaskId: string, isChecked: boolean) {
      const inst = this.todayInstances.find(i => i.id === instanceId);
      if (!inst) return;

      inst.subtaskCompletion[subtaskId] = isChecked;

      // Check if all subtasks are complete, then mark the parent task as complete
      const allSubtasksDone = Object.values(inst.subtaskCompletion).every(Boolean);
      inst.completed = allSubtasksDone;

      this.rerenderInstance(inst);
      this.updateProgress();
  }
  
  private rerenderInstance(inst: TaskInstance) {
    const oldEl = this.taskListEl.querySelector<HTMLElement>(`[data-instance-id="${inst.id}"]`);
    if(oldEl) {
        const newEl = this.createTaskElement(inst);
        oldEl.replaceWith(newEl);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DailyDinchariyaApp();
});