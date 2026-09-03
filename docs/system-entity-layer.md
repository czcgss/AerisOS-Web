# Future system entity layer

The system entity layer gives Future a common read-only language for objects owned by different Apps. It does not replace App Tools. Entities describe what exists; App actions still perform changes through the existing permission, approval, task, and operation-history pipeline.

## Entity contract

Every entity has a stable `future://` URI, a semantic type, an owning App, properties, relationships, and the App actions currently available for that exact object.

```json
{
  "uri": "future://calendar/event/event-1",
  "type": "calendar.event",
  "appId": "calendar",
  "id": "event-1",
  "title": "Product review",
  "properties": {
    "start": "2026-08-31T10:00"
  },
  "relationships": [
    {
      "predicate": "occursOn",
      "target": "future://calendar/date/2026-08-31"
    }
  ],
  "actions": [
    {
      "id": "calendar.event.delete",
      "tool": "future_calendar",
      "operation": "delete_event",
      "risk": "high",
      "parameters": {
        "eventId": "event-1"
      }
    }
  ]
}
```

Providers currently cover calendar events and dates, notes, reminders, files and folders, contacts, photos, music tracks, browser tabs, and weather locations. TextEdit, Preview, and Trash reuse filesystem identities, so one file keeps the same URI when it moves between App views. App workspace contexts carry both the stable URI and `entityType`, allowing an Agent handoff to refer to the exact object instead of copying or guessing its identity.

## Agent access

Worker Agents receive the read-only `future_entities` capability when at least one of their permitted Apps has an entity provider. It supports:

- `search` to discover permitted objects by text, type, date, or filesystem scope;
- `get` to resolve one stable URI;
- `related` to follow typed relationships.

The capability is constructed with the worker's effective App permissions. A Worker with Notes access cannot resolve Calendar or Files entities, even if it knows their URI. Changes still use the action's existing App Tool and therefore retain validation, approval, task tracking, operation history, and undo behavior.

## Adding a provider

Register a provider with `SystemEntityService` using a unique `type`, owning `appId`, and `owns`, `search`, and `get` functions. Provider output is normalized and validated by the service. Optional `related` resolution can produce entities that are connected dynamically rather than stored as explicit URI relationships.

Entity reads must remain side-effect free. Mutations belong in App actions, not entity providers.
