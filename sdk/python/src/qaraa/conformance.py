"""Emit normalized fixture results for the cross-language comparator."""
# Licensed under the Apache License, Version 2.0.
from __future__ import annotations
import json, sys
from pathlib import Path
from . import __version__
from .codec import decode_message

def main() -> None:
    if len(sys.argv)!=3: raise SystemExit("usage: python -m qaraa.conformance CONFORMANCE_V1 OUTPUT")
    root,output=Path(sys.argv[1]),Path(sys.argv[2]);manifest=json.loads((root/'manifest.json').read_text())
    cases=[]
    for entry in manifest:
        raw=json.loads((root/entry['file']).read_text())
        if entry['valid']:
            decoded=decode_message(raw,entry['schema']).model_dump(mode='json',by_alias=True,exclude_unset=True)
        else:
            try: decode_message(raw,entry['schema'])
            except Exception: decoded=None
            else: raise RuntimeError(f"invalid fixture accepted: {entry['file']}")
        cases.append({'fixture':entry['file'],'decoded':decoded,'roundTrip':decoded,'errorCode':entry.get('errorCode')})
    output.write_text(json.dumps({'language':'python','sdkVersion':__version__,'protocolVersion':1,'cases':cases},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
