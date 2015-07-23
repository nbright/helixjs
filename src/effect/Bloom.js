/**
 *
 * @constructor
 */
HX.BloomThresholdPass = function()
{
    HX.EffectPass.call(this, null, HX.BloomThresholdPass._fragmentShader);
    this.setThresholdLuminance(1.0);
};

HX.BloomThresholdPass.prototype = Object.create(HX.EffectPass.prototype);

HX.BloomThresholdPass.prototype.setThresholdLuminance = function(value)
{
    this._thresholdLuminance = value;
    this.setUniform("threshold", value);
};

HX.BloomThresholdPass.prototype.getThresholdLuminance = function()
{
    return this._thresholdLuminance;
};

/**
 * @constructor
 */
HX.BloomBlurPass = function(kernelSizes, weights, directionX, directionY, resolutionX, resolutionY)
{
    this._initWeights(kernelSizes, weights);

    var vertex = HX.BloomBlurPass.getVertexShader(this._kernelSize, directionX, directionY, resolutionX, resolutionY);
    var fragment = HX.BloomBlurPass.getFragmentShader(this._kernelSize, directionX, directionY, resolutionX, resolutionY)

    HX.EffectPass.call(this, vertex, fragment);

    this.setUniformArray("gaussianWeights", new Float32Array(this._weights));
};

HX.BloomBlurPass.prototype = Object.create(HX.EffectPass.prototype);

HX.BloomBlurPass.prototype._initWeights = function(kernelSizes, weights)
{
    this._kernelSize = 0;
    this._weights = [];

    var gaussians = [];

    for (var i = 0; i < kernelSizes.length; ++i) {
        var radius = Math.ceil(kernelSizes[i] * .5);
        var size = Math.ceil(kernelSizes[i]);
        if (size > this._kernelSize)
            this._kernelSize = size;
        gaussians[i] = HX.CenteredGaussianCurve.fromRadius(radius);
    }

    var radius = Math.ceil(this._kernelSize * .5);

    for (var j = 0; j < this._kernelSize; ++j) {
        this._weights[j] = 0;
        for (var i = 0; i < kernelSizes.length; ++i) {
            this._weights[j] += gaussians[i].getValueAt(j - radius) * weights[i];
        }
    }
};

/**
 *
 * @constructor
 */
HX.BloomCompositePass = function()
{
    HX.EffectPass.call(this, HX.BloomCompositePass._vertexShader, HX.BloomCompositePass._fragmentShader);
};

HX.BloomCompositePass.prototype = Object.create(HX.EffectPass.prototype);


/**
 *
 * @constructor
 */
HX.BloomEffect = function(blurSizes, weights)
{
    HX.Effect.call(this);

    this._downScale = 4;

    this._targetWidth = -1;
    this._targetHeight = -1;

    this._thresholdPass = new HX.BloomThresholdPass();
    this._compositePass = new HX.BloomCompositePass();

    this.addPass(this._thresholdPass);
    this.addPass(null);
    this.addPass(null);
    this.addPass(this._compositePass);

    this._thresholdMaps = [];
    this._thresholdFBOs = [];

    for (var i = 0; i < 2; ++i) {
        this._thresholdMaps[i] = new HX.Texture2D();
        this._thresholdMaps[i].setFilter(HX.TEXTURE_FILTER.BILINEAR_NOMIP);
        this._thresholdMaps[i].setWrapMode(HX.TEXTURE_WRAP_MODE.CLAMP);
        this._thresholdFBOs[i] = new HX.FrameBuffer([this._thresholdMaps[i]], HX.FrameBuffer.DEPTH_MODE_DISABLED);
    }

    this._blurSizes = blurSizes || [ 512, 256 ];

    if (HX.EXT_HALF_FLOAT_TEXTURES_LINEAR && HX.EXT_HALF_FLOAT_TEXTURES)
        this._weights = weights || [.05,.05 ];
    else {
        this._weights = weights || [1.5, 5.0 ];
        this.setThresholdLuminance(.9);
    }

    this._compositePass.setTexture("bloomTexture", this._thresholdMaps[0]);
};

HX.BloomEffect.prototype = Object.create(HX.Effect.prototype);

HX.BloomEffect.prototype.setThresholdLuminance = function(value)
{
    this._thresholdLuminance = value;
    this.setUniform("threshold", value);
};

HX.BloomEffect.prototype._initTextures = function()
{
    var hdrFormat = HX.OPTIONS.useHDR? HX.EXT_HALF_FLOAT_TEXTURES.HALF_FLOAT_OES : HX.GL.UNSIGNED_BYTE;

    for (var i = 0; i < 2; ++i) {
        this._thresholdMaps[i].initEmpty(Math.ceil(this._targetWidth / this._downScale), Math.ceil(this._targetHeight / this._downScale), HX.GL.RGB, hdrFormat);
        this._thresholdFBOs[i].init();
    }
};

HX.BloomEffect.prototype._initBlurPass = function()
{
    var sizesX = [];
    var sizesY = [];
    var len = this._blurSizes.length;
    for (var i = 0; i < len; ++i) {
        sizesX[i] = this._blurSizes[i] / this._downScale;
        sizesY[i] = this._blurSizes[i] / this._downScale;
    }

    var width = this._targetWidth / this._downScale;
    var height = this._targetHeight / this._downScale;
    // direction used to provide step size
    this._passes[1] = new HX.BloomBlurPass(sizesX, this._weights, 1, 0, width, height);
    this._passes[2] = new HX.BloomBlurPass(sizesY, this._weights, 0, 1, width, height);
    this._passes[1].setTexture("sourceTexture", this._thresholdMaps[0]);
    this._passes[2].setTexture("sourceTexture", this._thresholdMaps[1]);

    var mesh = this._mesh;
    if (mesh) {
        this._mesh = null;
        this.setMesh(mesh);
    }
};

HX.BloomEffect.prototype.draw = function(dt)
{
    if (this._hdrTarget._width != this._targetWidth || this._hdrTarget._height != this._targetHeight) {
        this._targetWidth = this._hdrTarget._width;
        this._targetHeight = this._hdrTarget._height;
        this._initTextures();
        this._initBlurPass();
    }

    var targetIndex = 0;
    HX.GL.viewport(0, 0, this._thresholdMaps[0]._width, this._thresholdMaps[0]._height);

    for (var i = 0; i < 3; ++i) {
        HX.setRenderTarget(this._thresholdFBOs[targetIndex]);
        this._drawPass(this._passes[i]);
        targetIndex = 1 - targetIndex;
    }

    HX.setRenderTarget(this._hdrTarget);
    HX.GL.viewport(0, 0, this._targetWidth, this._targetHeight);
    this._drawPass(this._compositePass);
    this._swapHDRBuffers();
};

HX.BloomEffect.prototype.dispose = function()
{
    for (var i = 0; i < 2; ++i) {
        this._thresholdFBOs[i].dispose();
        this._thresholdMaps[i].dispose();
    }

    this._thresholdFBOs = null;
    this._thresholdMaps = null;
};

HX.BloomEffect.prototype.getThresholdLuminance = function()
{
    return this.getPass(0).getThresholdLuminance();
};

HX.BloomEffect.prototype.setThresholdLuminance = function(value)
{
    return this.getPass(0).setThresholdLuminance(value);
};

HX.BloomThresholdPass._fragmentShader =
    "varying vec2 uv;\n\
    \n\
    #includeHelix\n\
    \n\
    uniform sampler2D hx_source;\n\
    \n\
    uniform float threshold;\n\
    \n\
    void main()\n\
    {\n\
        vec4 color = texture2D(hx_source, uv);\n\
        float originalLuminance = .05 + hx_luminance(color);\n\
        float targetLuminance = max(originalLuminance - threshold, 0.0);\n\
        gl_FragColor = color * targetLuminance / originalLuminance;\n\
    }";

HX.BloomCompositePass._vertexShader =
    "precision mediump float;\
       \
       attribute vec4 hx_position;\
       attribute vec2 hx_texCoord;\
       \
       varying vec2 uv;\
       \
       void main()\
       {\
               uv = hx_texCoord;\n\
               gl_Position = hx_position;\n\
       }";

HX.BloomCompositePass._fragmentShader =
    "varying vec2 uv;\n\
    \n\
    uniform sampler2D hx_source;\n\
    uniform sampler2D bloomTexture;\n\
    \n\
    void main()\n\
    {\n\
        gl_FragColor = texture2D(hx_source, uv) + texture2D(bloomTexture, uv);\n\
    }";

HX.BloomBlurPass.getVertexShader = function(kernelSize, directionX, directionY, resolutionX, resolutionY)
{
    return  "#define SOURCE_RES vec2(float(" + resolutionX + "), float(" + resolutionY + "))\n\
            #define RADIUS float(" + Math.ceil(kernelSize * .5) + ")\n\
            #define DIRECTION vec2(" + directionX + ", " + directionY + ")\n\
            precision mediump float;\n\
            \n\
            attribute vec4 hx_position;\n\
            attribute vec2 hx_texCoord;\n\
            \n\
            varying vec2 uv;\n\
            \n\
            void main()\n\
            {\n\
                    uv = hx_texCoord - RADIUS * DIRECTION / SOURCE_RES;\n\
                    gl_Position = hx_position;\n\
            }";
};

HX.BloomBlurPass.getFragmentShader = function(kernelSize, directionX, directionY, resolutionX, resolutionY)
{
    return  "#define SOURCE_RES vec2(float(" + resolutionX + "), float(" + resolutionY + "))\n\
            #define NUM_SAMPLES " + kernelSize + "\n\
            #define DIRECTION vec2(" + directionX + ", " + directionY + ")\n\
            \n\
            varying vec2 uv;\n\
            \n\
            uniform sampler2D sourceTexture;\n\
            \n\
            uniform float gaussianWeights[NUM_SAMPLES];\n\
            \n\
            void main()\n\
            {\n\
                vec4 total = vec4(0.0);\n\
                vec2 sampleUV = uv;\n\
                vec2 stepSize = DIRECTION / SOURCE_RES;\n\
                float totalWeight = 0.0;\n\
                for (int i = 0; i < NUM_SAMPLES; ++i) {\n\
                    vec4 sample = texture2D(sourceTexture, sampleUV);\n\
                    total += sample * gaussianWeights[i];\n\
                    sampleUV += stepSize;\n\
                }\n\
                gl_FragColor = total;\n\
            }";
};