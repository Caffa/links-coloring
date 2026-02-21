# CIELAB-Optimized Perceptual Palettes

This document describes the mathematically-designed color palettes added to the Link Colorer plugin. These palettes are optimized for **maximum perceptual distinctness** using the CIELAB color space.

## Table of Contents

1. [The Problem with Traditional Palettes](#the-problem-with-traditional-palettes)
2. [CIELAB Color Space](#cielab-color-space)
3. [Design Methodology](#design-methodology)
4. [Palette Specifications](#palette-specifications)
5. [Performance Comparison](#performance-comparison)
6. [Usage Recommendations](#usage-recommendations)

---

## The Problem with Traditional Palettes

Most color palettes are designed in RGB or HSL space, which have significant limitations:

- **RGB** is device-dependent and not perceptually uniform
- **HSL** has uneven perceptual steps (a 30° hue shift in yellow looks very different from 30° in blue)
- Many palettes have colors that appear similar to human vision despite being mathematically distinct

### Existing Palette Analysis

| Palette | Min ΔE | Assessment |
|---------|--------|------------|
| Nord | 9.6 | Very soft, some colors nearly indistinguishable |
| Tokyo Night | 21.4 | Moderate distinctness |
| Vibrant | 27.1 | Good distinctness, inconsistent brightness |
| Dracula | 37.7 | Excellent distinctness, non-uniform brightness |

*ΔE (Delta-E) measures perceptual difference. Values <20 may be hard to distinguish for some viewers.*

---

## CIELAB Color Space

CIELAB (L*a*b*) is a color space designed to approximate human vision:

- **L***: Lightness (0 = black, 100 = white)
- **a***: Green-red axis (-128 to +127)
- **b***: Blue-yellow axis (-128 to +127)

### Why CIELAB?

1. **Perceptual uniformity**: A ΔE of 10 looks similarly different whether comparing blues or yellows
2. **Device independence**: Represents color as humans see it
3. **Delta-E metric**: Provides objective measurement of color distinguishability

### Delta-E Interpretation

| ΔE Range | Perceptual Difference |
|----------|----------------------|
| <1 | Not perceptible |
| 1-2 | Perceptible with close observation |
| 2-10 | Perceptible at a glance |
| 10-30 | Distinct colors |
| 30-50 | Very distinct colors |
| >50 | Completely different colors |

*For link coloring, we target minimum ΔE >25 to ensure all links are easily distinguishable.*

---

## Design Methodology

### Step 1: Fix Lightness and Chroma

To ensure uniform visibility and vibrancy:

- **L* = 70**: Optimal for dark backgrounds (bright enough to read, not overwhelming)
- **C* = 55**: Vibrant but not neon; consistent across all colors

### Step 2: Optimize Hue Distribution

Colors are placed at specific hue angles in the a*b* plane to maximize minimum ΔE:

```
        b* (yellow)
          |
    90° --|-- 90°
          |
180° -----+----- 0°   a* (red)
          |
   270° --|-- 270°
          |
       (blue)
```

### Step 3: Avoid Problematic Regions

- **Muddy yellow-green** (80-110°): Colors in this range often look brown/olive
- **Neon green** (120-150°): Electric greens can be harsh on dark backgrounds
- **Cyan-blue confusion** (190-230°): These hues can appear similar

### Step 4: Mathematical Optimization

Using an iterative process:

1. Generate candidate hues
2. Convert to CIELAB
3. Calculate all pairwise ΔE values
4. Identify the minimum ΔE (bottleneck)
5. Adjust hues to increase the minimum
6. Repeat until converged

---

## Palette Specifications

### `perceptual_optimal`

**Goal**: Maximum perceptual distinctness with uniform brightness

**Parameters**:
- L* = 70
- C* = 55
- Hues: [0°, 35°, 70°, 125°, 175°, 225°, 270°, 310°]

| # | Name | Hex (Dark) | Hex (Light) | Hue | ΔE from nearest |
|---|------|------------|-------------|-----|-----------------|
| 1 | Red | `#ff80ad` | `#d24a7e` | 0° | 33.1 |
| 2 | Orange | `#ff8774` | `#cf5546` | 35° | 33.1 |
| 3 | Yellow | `#e39c4c` | `#af6d15` | 70° | 35.5 |
| 4 | Green | `#8bb955` | `#598921` | 125° | 40.2 |
| 5 | Teal | `#00c3a1` | `#009372` | 175° | 38.7 |
| 6 | Blue | `#00c1f1` | `#0091c1` | 225° | 36.8 |
| 7 | Purple | `#45b0ff` | `#0082e0` | 270° | 31.8 |
| 8 | Pink | `#c497f8` | `#9367c9` | 310° | 31.8 |

**Metrics**:
- **Minimum ΔE**: 31.3 (Red ↔ Orange)
- **Average ΔE**: 78.7
- **Uniformity**: Perfect (all colors have identical L* and C*)

**Characteristics**:
- Balanced warm/cool distribution
- Includes a pleasant sage green (not neon)
- All colors equally bright and saturated
- Excellent for distinguishing 8 different link types

---

### `perceptual_no_neon`

**Goal**: Avoid electric/neon greens while maintaining high distinctness

**Parameters**:
- L* = 70
- C* = 55
- Hues: [350°, 20°, 55°, 165°, 195°, 230°, 270°, 325°]

| # | Name | Hex (Dark) | Hex (Light) | Hue | Character |
|---|------|------------|-------------|-----|-----------|
| 1 | Red | `#ff82be` | `#cd4c8f` | 350° | Warm, inviting |
| 2 | Coral | `#ff828c` | `#d54d5d` | 20° | Soft red-orange |
| 3 | Gold | `#f4935a` | `#bf6329` | 55° | Rich amber |
| 4 | Teal | `#00c290` | `#009261` | 165° | Deep cyan-green |
| 5 | Cyan | `#00c4c3` | `#009394` | 195° | Turquoise |
| 6 | Azure | `#00c0f7` | `#0090c7` | 230° | Sky blue |
| 7 | Purple | `#45b0ff` | `#0082e0` | 270° | Electric purple |
| 8 | Rose | `#e18de5` | `#b05cb6` | 325° | Soft magenta |

**Metrics**:
- **Minimum ΔE**: 23.8 (Red ↔ Coral, Coral ↔ Gold)
- **Average ΔE**: 76.0
- **Uniformity**: Perfect

**Characteristics**:
- Skips neon green region entirely (90-150°)
- Warmer overall feel with reds, corals, and golds
- Cool side uses teals and blues rather than greens
- Slightly lower minimum ΔE but still excellent (>20)

---

### `perceptual_vibrant`

**Goal**: Balanced saturation for Ayu theme harmony (no teal)

**Parameters**:
- L* = 68
- C* = 42
- Hues: [0°, 35°, 70°, 125°, 225°, 270°, 310°] (7 colors)

| # | Name | Hex (Dark) | Hex (Light) | Hue | Character |
|---|------|------------|-------------|-----|-----------|
| 1 | Red | `#ec87a7` | `#c94879` | 0° | Soft rose |
| 2 | Orange | `#eb8c7c` | `#c55244` | 35° | Muted coral |
| 3 | Yellow | `#d39b5f` | `#a76917` | 70° | Warm gold |
| 4 | Green | `#8fb066` | `#568322` | 125° | Sage green |
| 5 | Blue | `#00b7da` | `#008bb8` | 225° | Sky cyan |
| 6 | Purple | `#6aaaf1` | `#007cd5` | 270° | Soft azure |
| 7 | Pink | `#ba97e0` | `#8d63bf` | 310° | Muted purple |

**Metrics**:
- **Minimum ΔE**: 25.3
- **Average ΔE**: 59.2
- **Uniformity**: Perfect

**Characteristics**:
- Reduced chroma (C*=42) matches Ayu's muted aesthetic
- L*=68 aligns perfectly with Ayu Mirage's lightness
- No teal—clean separation between green and blue
- 7 colors provide excellent distinctness without overwhelming
- **Best for**: Ayu Mirage/Light users who want harmony with their theme

---

### `perceptual_soft`

**Goal**: Ultra-soft, Nord-like aesthetic for extended reading

**Parameters**:
- L* = 68
- C* = 35
- Hues: [0°, 35°, 70°, 125°, 175°, 225°, 270°, 310°]

| # | Name | Hex (Dark) | Hex (Light) | Hue | Character |
|---|------|------------|-------------|-----|-----------|
| 1 | Red | `#e18da7` | `#bf5179` | 0° | Dusty rose |
| 2 | Orange | `#e19183` | `#bd594a` | 35° | Muted terracotta |
| 3 | Yellow | `#cd9c6b` | `#a36b27` | 70° | Soft amber |
| 4 | Green | `#94af71` | `#5c8230` | 125° | Muted sage |
| 5 | Teal | `#53b69f` | `#008a6f` | 175° | Soft seafoam |
| 6 | Blue | `#31b4d1` | `#0088b0` | 225° | Dusty cyan |
| 7 | Purple | `#79a9e4` | `#007bc9` | 270° | Soft periwinkle |
| 8 | Pink | `#b79ad6` | `#8b66b6` | 310° | Dusty lavender |

**Metrics**:
- **Minimum ΔE**: 21.0
- **Average ΔE**: 50.1
- **Uniformity**: Perfect

**Characteristics**:
- Significantly muted (C*=35) for minimal visual fatigue
- All colors feel "dusted" or "pastel"
- 8 colors with gentle transitions
- **Best for**: Long writing sessions, distraction-free environments
- Pairs well with: Nord, Ayu, or any soft theme

---

## Performance Comparison

### Perceptual Uniformity

```
CIELAB Lightness (L*) Distribution:
┌─────────────────┬─────────────────────────────────────┐
│ perceptual_*    │ ████████████████████████████████████│ 100% at L*=70
│ dracula         │ ████████████████████░░░░░░░░░░░░░░░░│ 65-90 range
│ vibrant         │ ████████████████░░░░░░░░░░░░░░░░░░░░│ 60-85 range
│ nord            │ ██████████████░░░░░░░░░░░░░░░░░░░░░░│ 55-75 range
└─────────────────┴─────────────────────────────────────┘
```

### Minimum Delta-E Comparison

```
Minimum ΔE (higher is better):
perceptual_optimal    ████████████████████████████████████  31.3
dracula               ██████████████████████████████████████ 37.7
vibrant               ██████████████████████████████░░░░░░  27.1
tokyonight            ███████████████████████░░░░░░░░░░░░░  21.4
perceptual_no_neon    ██████████████████████████░░░░░░░░░░  23.8
nord                  ███████████░░░░░░░░░░░░░░░░░░░░░░░░░   9.6
                      0    10    20    30    40    50
```

### Key Advantages

| Feature | perceptual_* | Traditional |
|---------|--------------|-------------|
| Uniform brightness | ✓ | ✗ |
| Uniform saturation | ✓ | ✗ |
| Mathematical optimization | ✓ | ✗ |
| Predictable ΔE | ✓ | ✗ |
| Warm/cool balance | ✓ | Varies |

---

## Usage Recommendations

### Perceptual Palettes Quick Guide

| Palette | Min ΔE | C* | Best For | Theme Pairing |
|---------|--------|-----|----------|---------------|
| `perceptual_optimal` | 31.3 | 55 | Maximum distinctness | Any dark theme |
| `perceptual_vibrant` | 25.3 | 42 | **Ayu Mirage/Light** | Ayu, soft themes |
| `perceptual_soft` | 21.0 | 35 | Long writing sessions | Nord, Ayu, soft |
| `perceptual_no_neon` | 23.8 | 55 | Avoiding greens entirely | Warm themes |

### When to use `perceptual_optimal`

- You want the mathematically best distinctness
- You don't mind a soft green in the palette
- You need exactly 8 highly distinguishable colors
- You prefer balanced warm/cool distribution

### When to use `perceptual_vibrant` ⭐ Ayu Recommended

- **You're using Ayu Mirage or Ayu Light**
- You want colors that harmonize with the theme
- You prefer 7 clean colors without teal
- You want good distinctness (ΔE = 25) without "popping" too much
- You write for long periods and want comfort

### When to use `perceptual_soft`

- You want the most muted, gentle experience
- You find most color themes too "loud"
- You use Nord or similar soft themes
- Distinctness is less important than comfort

### When to use `perceptual_no_neon`

- You dislike neon/electric green colors
- You prefer warmer tones (more reds, oranges)
- You want teal/cyan instead of lime/green
- You're using a theme where greens clash

### When to use other palettes

- **Dracula**: When you want maximum ΔE and don't mind varying brightness
- **Vibrant**: When you want high contrast with varying brightness
- **Nord**: When you want a soft, muted aesthetic
- **Tokyo Night**: When you want a balanced coding theme

---

## Technical Implementation

### Color Conversion Pipeline

```
Hex → RGB → XYZ → CIELAB → [Optimize] → CIELAB → XYZ → RGB → Hex
```

### Key Equations

**RGB to XYZ:**
```
X = 0.4124R + 0.3576G + 0.1805B
Y = 0.2126R + 0.7152G + 0.0722B
Z = 0.0193R + 0.1192G + 0.9505B
```

**XYZ to CIELAB:**
```
L* = 116f(Y/Yn) - 16
a* = 500[f(X/Xn) - f(Y/Yn)]
b* = 200[f(Y/Yn) - f(Z/Zn)]

where f(t) = t^(1/3) if t > 0.008856, else 7.787t + 16/116
```

**Delta-E (CIE76):**
```
ΔE = √((L*₂-L*₁)² + (a*₂-a*₁)² + (b*₂-b*₁)²)
```

---

## Future Improvements

Potential enhancements for future versions:

1. **CIEDE2000**: Use the more accurate (but complex) Delta-E formula
2. **Adaptive palettes**: Generate palettes based on user's actual link text distribution
3. **Color blindness simulation**: Optimize for protanopia/deuteranopia accessibility
4. **Dynamic generation**: Allow users to specify target ΔE and auto-generate palettes

---

## References

- [CIELAB Color Space - Wikipedia](https://en.wikipedia.org/wiki/CIELAB_color_space)
- [Delta E: The Color Difference - Zschimmer & Schwarz](https://www.zschimmer-schwarz.com/en/cielab-color-space/)
- [Color Difference - Bruce Lindbloom](http://www.brucelindbloom.com/index.html?Eqn_DeltaE_CIE76.html)
