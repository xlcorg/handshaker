# Method change

Changing the method on a request that is already saved asks first. The end
state that proves this works: the dialog title is `Change method?` and its
text names the saved method and the picked method. Cancel leaves the saved
method on the picker. Change current replaces that method. Create new adds a
sibling row and opens the sibling. A draft that is not saved applies the
picked method and shows no dialog.

## Sub-features

- Dialog buttons `Cancel`, `Create new`, and `Change current`. Escape does
  what Cancel does. The scrim does not close the dialog. There is no X.
- Change current keeps a request name the user edited. It renames only a
  request whose name is still the old method name.
- Create new copies the address, TLS choice, body, metadata, and auth. The
  sibling stays in the same folder. Its name is the new method name.
- Picking the method that is already selected does not ask. The call still
  applies.
- An unsaved draft does not ask. An HTTP draft does not ask.
- The body names the short service and both methods: `Echo / Send is saved. Create a new request for Echo / ServerStream, or change this request.` (`messages.workflow.methodChange.body`, service shortened by `serviceShortName`).
- Body field hints. The Request tab toggle is `aria-label="Toggle field hints"` (pref `bodyHints`, on by default). `useContractRead` drops the previous method's input and output schemas in the same turn the selected method changes, then reads the new contract immediately instead of waiting out the 400ms address debounce. The dialog does not change the method, so the old hints stay until Change current, until Create new opens the sibling, or until a draft applies the pick.

## How to get to it (user POV)

Start the echo server the way [Unary call](unary-call.md) does. In the
window, open the sidebar `+` menu and choose `New request`. Type
`127.0.0.1:50051` in the address. Open the method dropdown (the control that
says `Select a method`), wait until `Echo` / `Send` appears, and click `Send`.
Click `Save` (`aria-label="Save"`). The save dialog name field is
`aria-label="Request name"`. Save into `My Collection`. The toolbar then
shows `Saved`.

Open the method dropdown again and click a different method row, such as
`ServerStream`. The dialog appears. The picker still shows `Send` until you
choose Change current or Create new.

## Driving it with Tauri WebDriver

Save a unary `Send` first, using the address and method steps in
[Unary call](unary-call.md). The method row is that same control:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//button[contains(@class,\"mp-mrow\")][.//span[contains(@class,\"mp-mname\") and text()=\"Send\"]]"
```

After the request is saved, open the dropdown and click a different `mp-mrow`.
The dialog is `[role="alertdialog"]`.

```sh
.cursor/skills/control-app/scripts/hsdrv.py eval 'const d=document.querySelector("[role=alertdialog]"); return d?d.innerText:""'
```

That string contains the saved method and the picked method. Cancel:

```sh
.cursor/skills/control-app/scripts/hsdrv.py click "xpath=//div[@role=\"alertdialog\"]//button[normalize-space()=\"Cancel\"]"
```

The picker button still shows `Send`. Change current is the button
`Change current` in that dialog. Create new is the button `Create new`. After
Create new, the open request row is the new sibling (`data-node-id` on the
row in `[aria-label="collections-tree"]`), and the picker shows the method
you picked.

A draft shows no dialog. `aria-label="new-request"` opens one. Picking `Send`
updates the picker. `[role="alertdialog"]` stays absent.

## Gotchas

- The dialog is for a saved gRPC request and a different method. The same
  method applies immediately.
- HTTP requests do not use this dialog.
- Create new does not edit the request that was open. It adds a sibling and
  opens that sibling.
- A second method click while the dialog is open does not change the
  question. The text keeps the first picked method.
- The method list is empty until reflection returns. The picker footer is the
  status, as in the unary call note.
