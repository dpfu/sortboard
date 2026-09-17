# SortBoard demo images

All 60 images are AI-generated. This collection pairs 30 DiffusionDB images with 30 Imagegen outputs made from the same original prompts.

DiffusionDB source: https://huggingface.co/datasets/poloclub/diffusiondb . Its dataset card designates the original images CC0-1.0. The originals come from the 2022 collection, archive images/part-000001.zip. Individual timestamps and exact checkpoints are unknown. Thirty prompts were manually selected from 47 visually reviewed candidates in the first 1,000 records. This is a varied demo selection, not a representative sample.

The newer images were generated on 2026-09-10 using image_gen.imagegen: one call per unchanged prompt, no reference images or additional instructions, and no rerolls. The exact model, seed and revised prompt were not reported. These outputs are not assigned the DiffusionDB CC0 license.

The app serves WebP copies with a maximum dimension of 1024 pixels, quality 88, without cropping. Source PNG checksums, exact prompts, generation parameters and demo-copy checksums are included in the catalog and in each imported card's Notes. The full-resolution PNGs remain in the local demo archive.

Same prompts do not constitute a controlled model benchmark. Aspect ratios, generation settings, image content and unsolicited text differ. Closed Sort asks about perceived origin; it does not compare a mixed AI/non-AI dataset. Q-Sort records subjective impressions.

scripts/build-demo-assets.py (Python and Pillow) creates the WebP copies and catalog from the local full-resolution demo archive. The checked-in WebP files and catalog are sufficient for normal builds; Python is not a production dependency.
