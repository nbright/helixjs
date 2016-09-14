/**
 * BasicMaterial is the default physically plausible rendering material.
 * @constructor
 */
HX.BasicMaterial = function()
{
    HX.Material.call(this);
    this._lightingModel = null;
    this._passesInvalid = true;
    this._color = new HX.Color(1, 1, 1, 1);
    this._colorMap = null;
    this._doubleSided = false;
    this._normalMap = null;
    this._specularMap = null;
    this._maskMap = null;
    this._specularMapMode = HX.BasicMaterial.SPECULAR_MAP_ROUGHNESS_ONLY;
    this._metallicness = 0.0;
    this._alpha = 1.0;
    this._minRoughness = 0.3;
    this._maxRoughness = 1.0;
    this._normalSpecularReflectance = 0.027;
    this._alphaThreshold = 1.0;
    this._useVertexColors = false;
    this._lights = null;

    // trigger assignments
    this.color = this._color;
    this.alpha = this._alpha;
    this.metallicness = this._metallicness;
    this.setRoughness(this._minRoughness);
    this.normalSpecularReflectance = this._normalSpecularReflectance;
};

HX.BasicMaterial.roughnessFromShininess = function(specularPower)
{
    return Math.sqrt(2.0/(specularPower + 2.0));
};

/**
 * used for specularMapMode to specify the specular map only uses roughness data
 */
HX.BasicMaterial.SPECULAR_MAP_ROUGHNESS_ONLY = 1;
/**
 * used for specularMapMode to specify the specular map has rgb channels containing roughness, normal reflectance and metallicness, respectively
 */
HX.BasicMaterial.SPECULAR_MAP_ALL = 2;
/**
 * used for specularMapMode to specify there is no explicit specular map, but roughness data is present in the alpha channel of the normal map.
 */
HX.BasicMaterial.SPECULAR_MAP_SHARE_NORMAL_MAP = 3;


HX.BasicMaterial.prototype = Object.create(HX.Material.prototype,
    {
        doubleSided: {
            get: function()
            {
                return this._doubleSided;
            },

            set: function(value)
            {
                this._doubleSided = value;

                for (var i = 0; i < HX.MaterialPass.NUM_PASS_TYPES; ++i) {
                    if (this._passes[i])
                        this._passes[i].cullMode = value ? HX.CullMode.NONE : HX.CullMode.BACK;
                }
            }
        },

        // only used with TransparencyMode.ALPHA
        alpha: {
            get: function ()
            {
                return this._alpha;
            },
            set: function (value)
            {
                this._alpha = HX.saturate(value);
                this.setUniform("alpha", this._alpha);
            }
        },

        // only used with TransparencyMode.ALPHA
        lights: {
            get: function ()
            {
                return this._lights;
            },
            set: function (value)
            {
                this._passesInvalid = true;
                if (!this._lightingModel) this._lightingModel = HX.LightingModel.GGX;
                this._lights = value;
            }
        },

        // this can ONLY be used if the MeshData was created with a hx_vertexColor attribute!
        useVertexColors: {
            get: function ()
            {
                return this._useVertexColors;
            },
            set: function (value)
            {
                if (this._useVertexColors !== value)
                    this._passesInvalid = true;

                this._useVertexColors = value;
            }
        },

        color: {
            get: function ()
            {
                return this._color;
            },
            set: function (value)
            {
                this._color = isNaN(value) ? value : new HX.Color(value);
                this.setUniform("color", this._color);
            }
        },

        colorMap: {
            get: function ()
            {
                return this._colorMap;
            },
            set: function (value)
            {
                if (!!this._colorMap !== !!value)
                    this._passesInvalid = true;

                if (!this._passesInvalid && value)
                    this.setTexture("colorMap", value);

                this._colorMap = value;
            }
        },

        lightingModel: {
            get: function ()
            {
                return this._lightingModel;
            },
            set: function (value)
            {
                if (this._lightingModel !== value)
                    this._passesInvalid = true;

                this._lightingModel = value;
            }
        },

        normalMap: {
            get: function ()
            {
                return this._normalMap;
            },
            set: function (value)
            {
                if (!!this._normalMap !== !!value)
                    this._passesInvalid = true;

                if (!this._passesInvalid && value)
                    this.setTexture("normalMap", value);

                this._normalMap = value;
            }
        },

        /**
         * The roughness in the specular map is encoded as shininess; ie: lower values result in higher roughness to reflect the apparent brighness of the reflection. This is visually more intuitive.
         */
        specularMap: {
            get: function ()
            {
                return this._specularMap;
            },
            set: function (value)
            {
                if (!!this._specularMap !== !!value)
                    this._passesInvalid = true;

                if (!this._passesInvalid && value)
                    this.setTexture("specularMap", value);

                this._specularMap = value;
            }
        },

        maskMap: {
            get: function ()
            {
                return this._maskMap;
            },
            set: function (value)
            {
                if (!!this._maskMap !== !!value)
                    this._passesInvalid = true;

                if (!this._passesInvalid && value)
                    this.setTexture("maskMap", value);

                this._maskMap = value;
            }
        },

        specularMapMode: {
            get: function ()
            {
                return this._specularMapMode;
            },
            set: function (value)
            {
                if (this._specularMapMode != value)
                    this._passesInvalid = true;

                this._specularMapMode = value;
            }
        },

        metallicness: {
            get: function ()
            {
                return this._metallicness;
            },
            set: function (value)
            {
                this._metallicness = HX.saturate(value);
                this.setUniform("metallicness", this._metallicness);
            }
        },

        normalSpecularReflectance: {
            get: function ()
            {
                return this._normalSpecularReflectance;
            },
            set: function (value)
            {
                this._normalSpecularReflectance = HX.saturate(value);
                this.setUniform("normalSpecularReflectance", this._normalSpecularReflectance);
            }
        },

        minRoughness:
        {
            get: function ()
            {
                return this._minRoughness;
            },

            set: function(value)
            {
                this._minRoughness = value;
                this.setUniform("minRoughness", this._minRoughness);
            }
        },

        maxRoughness:
        {
            get: function ()
            {
                return this._maxRoughness;
            },

            set: function(value)
            {
                this._maxRoughness = value;
                this.setUniform("minRoughness", this._minRoughness);
            }
        },

        alphaThreshold:
        {
            get: function() { return this._alphaThreshold; },
            set: function(value) {
                value = HX.saturate(value);
                if ((this._alphaThreshold === 1.0) != (value === 1.0))
                    this._passesInvalid = true;
                this._alphaThreshold = value;
                this.setUniform("alphaThreshold", value);
            }
        }
    }
);

HX.BasicMaterial.prototype.setRoughness = function(min, max)
{
    this.minRoughness = min;
    this.maxRoughness = max || 1.0;
};

HX.BasicMaterial.prototype.getPass = function(type)
{
    if (this._passesInvalid)
        this._updatePasses();

    return HX.Material.prototype.getPass.call(this, type);
};

HX.BasicMaterial.prototype._clearPasses = function()
{
    for (var i = 0; i < HX.MaterialPass.NUM_PASS_TYPES; ++i)
        this._setPass(i, null);
};

HX.BasicMaterial.prototype._updatePasses = function()
{
    this._clearPasses();

    var defines = this._generateDefines();

    this.init(HX.ShaderLibrary.get("default_geometry_vertex.glsl", defines), HX.ShaderLibrary.get("default_geometry_fragment.glsl", defines), this._lightingModel, this._lights);

    this.setUniform("color", this._color);
    this.setUniform("alpha", this._alpha);
    this.setUniform("alphaThreshold", this._alphaThreshold);

    this.setUniform("maxRoughness", this._maxRoughness);
    this.setUniform("minRoughness", this._minRoughness);

    if (this._colorMap) this.setTexture("colorMap", this._colorMap);
    if (this._normalMap) this.setTexture("normalMap", this._normalMap);
    if (this._specularMap) this.setTexture("specularMap", this._specularMap);

    this._passesInvalid = false;
};

HX.BasicMaterial.prototype._generateDefines = function()
{
    var defines = {};
    if (this._colorMap) defines.COLOR_MAP = 1;
    if (this._useVertexColors) defines.VERTEX_COLORS = 1;
    if (this._normalMap) defines.NORMAL_MAP = 1;
    if (this._maskMap) defines.MASK_MAP = 1;
    if (this._alphaThreshold) defines.ALPHA_THRESHOLD = 1;
    if (this._useSkinning) defines.USE_SKINNING = 1;

    switch (this._specularMapMode) {
        case HX.BasicMaterial.SPECULAR_MAP_ROUGHNESS_ONLY:
            if (this._specularMap) defines.ROUGHNESS_MAP = 1;
            break;
        case HX.BasicMaterial.SPECULAR_MAP_ALL:
            if (this._specularMap) defines.SPECULAR_MAP = 1;
        default:
            defines.NORMAL_ROUGHNESS_MAP = 1;
    }
    return defines;
};

HX.BasicMaterial.prototype._setUseSkinning = function(value)
{
    if (this._useSkinning !== value)
        this._passesInvalid = true;

    this._useSkinning = value;
};