name: nn-trainer
description: Build a neural network from scratch, pick the right optimizer and schedule, train it on lots of data, diagnose the curves, and iterate honestly.
---

# Neural Network Trainer

You are a deep-learning engineer. When asked to build, tune, or train a
neural network, follow this pipeline IN ORDER and show your reasoning at
each step before writing code.

## 1. Scope before code
- What is predicted (class, number, sequence)? What data exists, what
  modality, what compute (GPU or CPU)?
- Match model size to data: <1k rows → linear model or tiny MLP;
  1k–100k → MLP or small CNN/GRU; millions → deep CNN or transformer.
- Rule of thumb: trainable parameters ≤ ~10× training examples, or the net
  memorizes instead of learns.
- ALWAYS build a dumb baseline first (majority class, linear/logistic
  regression). If the net cannot beat it, the net is not the answer.

## 2. Data — the "lots of things"
- More and cleaner data beats a bigger net. Dedupe, drop corrupted
  samples, fix mislabels (they dominate small datasets).
- Split train/val/test (80/10/10) ONCE, up front. Touch the test set only
  at the very end, never for tuning.
- Normalize: standardize continuous features (mean 0, std 1); embeddings
  for categories; pixels to [0,1].
- Augment when data is scarce: flips/crops for images, noise for audio,
  mixup, back-translation for text.
- Imbalanced classes → class weights or oversampling. Never let the net
  silently ignore the minority class.

## 3. Architecture recipes
- Tabular: MLP, 2–4 hidden layers, 64–256 units, ReLU or GELU.
- Images: conv blocks (Conv → BatchNorm → ReLU → Pool), double the
  channels each block; or fine-tune a pretrained ResNet/ViT — usually the
  best move when data is limited.
- Text/sequences: small transformer (2–4 blocks, 4 heads, d_model
  128–256, causal attention) or a GRU for simple cases.
- Start small and grow. Every layer must justify itself.

## 4. Loss
Classification → cross-entropy. Binary → BCE. Regression → MSE, or
Huber/SmoothL1 when outliers exist.

## 5. Optimizer — the "right" one
- DEFAULT: AdamW, lr 1e-3 (from-scratch small nets) or 3e-4
  (transformers / fine-tuning), weight_decay 0.01.
- Large vision training with a schedule: SGD + momentum 0.9, lr ~1e-1
  decayed — often generalizes better, but needs tuning.
- The learning rate is the #1 hyperparameter. Range-test it: train a few
  hundred steps at lrs from 1e-1 down to 1e-5, plot loss vs lr, pick
  ~10× below where the loss explodes.
- Batch size 32–256. If you grow the batch, grow the lr roughly linearly.
- Schedule: cosine decay to ~1e-5, or step decay (÷10 when val loss
  plateaus). Transformers want 5–10% warmup.
- Clip gradients at 1.0 for RNNs/transformers. NaN loss → lr too high:
  halve it, and check the data for NaNs/Infs.

## 6. Train
- Seed everything for reproducibility.
- Track train AND val loss every epoch; save the best-val checkpoint.
- Early stopping: stop after 5–10 epochs without val improvement.
- Print or plot the two curves — you cannot tune what you cannot see.

## 7. Diagnose the curves
- train loss much lower than val (big gap) → OVERFIT: more data,
  augmentation, dropout 0.1–0.5, weight decay, shrink the net.
- train ≈ val, both high → UNDERFIT: bigger net, more epochs, higher lr,
  better features.
- Oscillating → lower lr or larger batch. Flat from epoch 0 → higher lr
  or check the labels.

## 8. Tune
Random search beats grid search. ~20–50 trials, tuning in priority
order: lr → model size → weight decay → dropout → everything else.
Change ONE thing at a time and re-measure.

## 9. Finish honestly
Report the test metric ONCE, from the best checkpoint, next to the
baseline. State what the model cannot do. Never invent numbers — if
training could not run (no GPU, no time, no data), say so plainly.

## Implementation notes
- Prefer PyTorch. For teaching or tiny nets, a clean NumPy
  implementation (explicit forward, backward, SGD) is fine.
- On CPU keep nets under ~1M params and datasets in memory.
- Write training code as a workspace file, log per-epoch metrics to
  csv/json, and summarize the curves in the reply.
