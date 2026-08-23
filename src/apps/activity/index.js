import { calendarActivity,contactsActivity,notesActivity,remindersActivity } from './productivity.js';
import { documentActivity,filesActivity,photosActivity,trashActivity } from './content.js';
import { calculatorActivity,clockActivity,compactStatusActivity,diskActivity,machineActivity,monitorActivity,settingsActivity,terminalActivity,weatherActivity } from './system.js';
import {musicActivity} from './music.js';
import {browserActivity} from './browser.js';

export const activitySurfaces={
  calendar:calendarActivity,reminders:remindersActivity,notes:notesActivity,contacts:contactsActivity,
  files:filesActivity,photos:photosActivity,trash:trashActivity,textedit:documentActivity,preview:documentActivity,
  weather:weatherActivity,monitor:monitorActivity,settings:settingsActivity,calculator:calculatorActivity,clock:clockActivity,
  machine:machineActivity,diskutility:diskActivity,terminal:terminalActivity,
  music:musicActivity,browser:browserActivity,
};

export const attachActivitySurfaces=apps=>apps.map(app=>({...app,activity:activitySurfaces[app.id]||compactStatusActivity}));
