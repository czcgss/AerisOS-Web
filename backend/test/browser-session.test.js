import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserService} from '../../src/services/BrowserService.js';

const storage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}};

test('browser session reset clears tabs but retains user browsing data',()=>{
  const browser=new BrowserService({storage:storage()});browser.start();
  browser.navigate('https://example.com');browser.toggleBookmark();browser.newTab('https://developer.mozilla.org');
  const before=browser.snapshot();assert.equal(before.tabs.length,2);assert.equal(before.bookmarks.length,1);assert.equal(before.history.length,2);
  browser.resetSession();const reset=browser.snapshot();assert.equal(reset.tabs.length,1);assert.equal(reset.tabs[0].url,'about:blank');assert.deepEqual(reset.tabs[0].entries,['about:blank']);assert.equal(reset.bookmarks.length,1);assert.equal(reset.history.length,2);
  const closedId=reset.tabs[0].id;assert.equal(browser.close(closedId),true);const final=browser.snapshot();assert.equal(final.tabs.length,1);assert.equal(final.tabs[0].url,'about:blank');assert.notEqual(final.tabs[0].id,closedId);
});
