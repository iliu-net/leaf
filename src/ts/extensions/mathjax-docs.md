---
title: Math Rendering (KaTeX)
---

# Math Rendering (KaTeX)

The mathjax plugin renders mathematical notation using
[KaTeX](https://katex.org/), a fast, lightweight TeX/LaTeX rendering
engine.  Both TeX/LaTeX and AsciiMath syntax are supported.

## Usage

Use fenced code blocks with one of the supported language tags.

### TeX / LaTeX

Use `tex`, `latex`, or `math` as the language tag:

````markdown
```tex
E = mc^2
```

```latex
\sum_{i=1}^{n} x_i = \frac{n(n+1)}{2}
```

```math
\int_{0}^{\infty} e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
```
````

### AsciiMath

Use `asciimath` or `amath` as the language tag:

````markdown
```asciimath
sum_{i=1}^n i^3 = ((n(n+1))/2)^2
```

```amath
int_0^1 f(x) dx
```
````

## Configuration

Add `"mathjax"` to the `markdown.plugins` list in your spa-config:

```json
{
  "markdown": {
    "plugins": ["mathjax"]
  }
}
```

No additional options are required.
