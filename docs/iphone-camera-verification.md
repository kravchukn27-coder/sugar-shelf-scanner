# iPhone camera verification

Run this on a physical iPhone in Safari after deployment; simulator and desktop emulation cannot validate camera lens selection or torch hardware.

1. Open the scanner, grant camera permission, and tap **Start scanning**.
2. Confirm the preview starts live and stays in the guide state until a product is captured.
3. If the device exposes a torch capability, verify the flashlight control toggles on and off. If not, confirm it is absent.
4. If the browser exposes a zoom range below 1×, verify the wider-view control appears, changes the field of view, and returns to standard view. It is a view request, not a physical-camera guarantee; Safari may select wide or ultra-wide hardware itself.
5. Capture a product and confirm the preview freezes; only full analysis shows a spinner; Details, retry, close, and torch retain their expected behavior.
