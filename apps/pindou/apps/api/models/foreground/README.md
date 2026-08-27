# Foreground model

The bundled `u2netp.onnx` artifact is the lightweight U-2-NetP salient-object model.
It provides a deterministic, class-agnostic foreground mask and removes the conversion
pipeline's dependency on Seedream returning Alpha or a chroma-key background.

The output is a soft saliency mask, not a physically exact optical Alpha Matte. The API
therefore validates every output and either returns an explicitly authorized Simplify
fallback or a stable 422 error when confidence is insufficient. Runtime/model failures
remain 503 errors and never trigger semantic degradation.

Provenance, preprocessing parameters, version and SHA-256 are pinned in `model.json`.
The upstream Apache-2.0 license is stored in `LICENSE`.
