# Foreground models

The image bundles both U²-Net family variants:

- `u2net.onnx`: the full model and the default quality-oriented choice.
- `u2netp.onnx`: the lightweight model retained for resource or latency rollback.

Set `FOREGROUND_MODEL_VARIANT=u2net` or `u2netp` to choose one globally. Both provide
deterministic, class-agnostic foreground masks after Seedream has generated the requested
chroma-key image for Solid mode.

The output is a soft saliency mask, not a physically exact optical Alpha Matte. The API
therefore validates every output and either returns an explicitly authorized Simplify
fallback or a stable 422 error when confidence is insufficient. Runtime/model failures
remain 503 errors and never trigger semantic degradation.

Provenance, preprocessing parameters, version and SHA-256 are pinned in the matching
`u2net.json` and `u2netp.json`. The upstream Apache-2.0 license is stored in `LICENSE`.

`output_activation=probability` declares that this artifact already returns absolute
0..1 confidence. Runtime code clips floating-point noise only; it must not apply per-image
min-max stretching, because that converts weak background noise into foreground Alpha.

The full model is about 168 MiB and exceeds GitHub's normal single-file limit, so
`u2net.onnx` is intentionally ignored by Git. It is downloaded and SHA256-verified during
the API image build. For local development, prepare it with:

```bash
apps/api/.venv/bin/python apps/api/scripts/download_foreground_model.py --variant u2net
```

The resulting runtime image still contains both variants and never downloads a model while
serving requests.
