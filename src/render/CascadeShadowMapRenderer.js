/**
 *
 * @constructor
 */
HX.CascadeShadowCasterCollector = function(numCascades)
{
    HX.SceneVisitor.call(this);
    this._renderCameras = null;
    this._bounds = new HX.BoundingAABB();
    this._numCascades = numCascades;
    this._cullPlanes = null;
    this._numCullPlanes = 0;
    this._renderLists = [];
};

HX.CascadeShadowCasterCollector.prototype = Object.create(HX.SceneVisitor.prototype);

HX.CascadeShadowCasterCollector.prototype.getRenderList = function(index) { return this._renderLists[index]; };

HX.CascadeShadowCasterCollector.prototype.collect = function(camera, scene)
{
    this._collectorCamera = camera;
    this._bounds.clear();

    for (var i = 0; i < this._numCascades; ++i) {
        this._renderLists[i] = [];
    }

    scene.acceptVisitor(this);
};

HX.CascadeShadowCasterCollector.prototype.getBounds = function()
{
    return this._bounds;
};

HX.CascadeShadowCasterCollector.prototype.setRenderCameras = function(cameras)
{
    this._renderCameras = cameras;
};

HX.CascadeShadowCasterCollector.prototype.setCullPlanes = function(cullPlanes, numPlanes)
{
    this._cullPlanes = cullPlanes;
    this._numCullPlanes = numPlanes;
};

HX.CascadeShadowCasterCollector.prototype.visitModelInstance = function (modelInstance, worldMatrix, worldBounds)
{
    if (modelInstance._castsShadows == false) return;

    this._bounds.growToIncludeBound(worldBounds);

    var passIndex = HX.MaterialPass.GEOMETRY_PASS;

    var numCascades = this._numCascades;
    var numMeshes = modelInstance.numMeshInstances();

    var lastCascade = numCascades - 1;
    for (var cascade = lastCascade; cascade >= 0; --cascade) {
        // no need to test the last split plane, always assume in if it's not entirely inside the previous (since it passed the frustum test)
        var renderList = this._renderLists[cascade];
        var renderCamera = this._renderCameras[cascade];

        if (cascade == lastCascade || worldBounds.intersectsConvexSolid(this._cullPlanes, this._numCullPlanes)) {

            for (var meshIndex = 0; meshIndex < numMeshes; ++meshIndex) {
                var meshInstance = modelInstance.getMeshInstance(meshIndex);
                var material = meshInstance.getMaterial();

                // TODO: ignore individual geometry passes if MRT is supported
                if (material.hasPass(passIndex)) {
                    var renderItem = new HX.RenderItem();
                    renderItem.pass = material.getPass(passIndex);
                    renderItem.meshInstance = meshInstance;
                    renderItem.worldMatrix = worldMatrix;
                    renderItem.camera = renderCamera;
                    renderItem.uniformSetters = meshInstance._uniformSetters[passIndex];

                    renderList.push(renderItem);
                }
            }

        }
        else
            cascade = 0;
    }
};

HX.CascadeShadowCasterCollector.prototype.qualifies = function(object)
{
    return object.getWorldBounds().intersectsConvexSolid(this._cullPlanes, this._numCullPlanes);
};

/**
 *
 * @constructor
 */
HX.CascadeShadowMapRenderer = function(light, numCascades, shadowMapSize)
{
    HX.Renderer.call(this);
    this._light = light;
    this._numCascades = numCascades || 3;
    if (this._numCascades > 4) this._numCascades = 4;
    this._shadowMapSize = shadowMapSize || 1024;
    this._shadowMapInvalid = true;
    this._shadowMap = new HX.Texture2D();
    this._fbo = new HX.FrameBuffer(null, HX.FrameBuffer.DEPTH_MODE_READ_WRITE, this._shadowMap);
    this._shadowMap.setFilter(HX.TEXTURE_FILTER.NEAREST_NOMIP);
    this._shadowMap.setWrapMode(HX.TEXTURE_WRAP_MODE.CLAMP);
    this._shadowMatrices = [ new HX.Matrix4x4(), new HX.Matrix4x4(), new HX.Matrix4x4(), new HX.Matrix4x4() ];
    this._transformToUV = [ new HX.Matrix4x4(), new HX.Matrix4x4(), new HX.Matrix4x4(), new HX.Matrix4x4() ];
    this._inverseLightMatrix = new HX.Matrix4x4();
    this._splitRatios = null;
    this._splitDistances = null;
    this._shadowMapCameras = null;
    this._collectorCamera = new HX.OrthographicOffCenterCamera();
    this._minZ = 0;
    this._numCullPlanes = 0;
    this._cullPlanes = [];
    this._localBounds = new HX.BoundingAABB();
    this._casterCollector = new HX.CascadeShadowCasterCollector(this._numCascades);

    this._initSplitRatios();
    this._initCameras();

    this._viewports = [];
};

HX.CascadeShadowMapRenderer.prototype = Object.create(HX.Renderer.prototype);

HX.CascadeShadowMapRenderer.prototype.setNumCascades = function(value)
{
    if (this._numCascades == value) return;
    this._numCascades = value;
    this._invalidateShadowMap();
    this._initSplitRatios();
    this._initCameras();
    this._casterCollector = new HX.CascadeShadowCasterCollector(value);
};

HX.CascadeShadowMapRenderer.prototype.setShadowMapSize = function(value)
{
    if (this._setShadowMapSize == value) return;
    this._setShadowMapSize = value;
    this._invalidateShadowMap();
};

HX.CascadeShadowMapRenderer.prototype.render = function(viewCamera, scene)
{
    if (this._shadowMapInvalid)
        this._initShadowMap();

    this._inverseLightMatrix.inverseAffineOf(this._light.getWorldMatrix());
    this._updateCollectorCamera(viewCamera);
    this._updateSplitDistances(viewCamera);
    this._updateCullPlanes(viewCamera);
    this._collectShadowCasters(scene);
    this._updateCascadeCameras(viewCamera, this._casterCollector.getBounds());

    HX.setRenderTarget(this._fbo);
    HX.GL.clear(HX.GL.DEPTH_BUFFER_BIT);

    for (var pass = 0; pass < this._numCascades; ++pass)
    {
        var viewport = this._viewports[pass];
        HX.GL.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

        this._renderPass(HX.MaterialPass.GEOMETRY_PASS, this._casterCollector.getRenderList(pass));
    }
};

HX.CascadeShadowMapRenderer.prototype._updateCollectorCamera = function(viewCamera)
{
    var corners = viewCamera.getFrustum()._corners;
    var min = new HX.Float4();
    var max = new HX.Float4();
    var tmp = new HX.Float4();

    this._inverseLightMatrix.transformPointTo(corners[0], min);
    max.copyFrom(min);

    for (var i = 1; i < 8; ++i) {
        this._inverseLightMatrix.transformPointTo(corners[i], tmp);
        min.minimize(tmp);
        max.maximize(tmp);
    }

    this._minZ = min.z;

    this._collectorCamera.getTransformationMatrix().copyFrom(this._light.getWorldMatrix());
    this._collectorCamera._invalidateWorldTransformation();
    this._collectorCamera.setBounds(min.x, max.x + 1, max.y + 1, min.y);
    this._collectorCamera._setRenderTargetResolution(this._shadowMap._width, this._shadowMap._height);
};

HX.CascadeShadowMapRenderer.prototype._updateSplitDistances = function(viewCamera)
{
    var nearDist = viewCamera.getNearDistance();
    var frustumRange = viewCamera.getFarDistance() - nearDist;

    for (var i = 0; i < this._numCascades; ++i)
        this._splitDistances[i] = nearDist + this._splitRatios[i]*frustumRange;
};

HX.CascadeShadowMapRenderer.prototype._updateCascadeCameras = function(viewCamera, bounds)
{
    this._localBounds.transformFrom(bounds, this._inverseLightMatrix);
    var minBound = this._localBounds.getMinimum();
    var maxBound = this._localBounds.getMaximum();

    var scaleSnap = 1.0;	// always scale snap to a meter

    var localNear = new HX.Float4();
    var localFar = new HX.Float4();
    var min = new HX.Float4();
    var max = new HX.Float4();

    var corners = viewCamera.getFrustum().getCorners();

    for (var cascade = 0; cascade < this._numCascades; ++cascade) {
        var farRatio = this._splitRatios[cascade];
        var camera = this._shadowMapCameras[cascade];

        camera.setNearDistance(-maxBound.z);

        camera.getTransformationMatrix().copyFrom(this._light.getWorldMatrix());
        camera._invalidateWorldTransformation();

        // figure out frustum bound
        for (var i = 0; i < 4; ++i) {
            var nearCorner = corners[i];
            var farCorner = corners[i + 4];

            localFar.x = nearCorner.x + (farCorner.x - nearCorner.x)*farRatio;
            localFar.y = nearCorner.y + (farCorner.y - nearCorner.y)*farRatio;
            localFar.z = nearCorner.z + (farCorner.z - nearCorner.z)*farRatio;

            this._inverseLightMatrix.transformPointTo(nearCorner, localNear);
            this._inverseLightMatrix.transformPointTo(localFar, localFar);

            if (i == 0) {
                min.copyFrom(localNear);
                max.copyFrom(localNear);
            }
            else {
                min.minimize(localNear);
                max.maximize(localNear);
            }

            min.minimize(localFar);
            max.maximize(localFar);
        }

        // do not render beyond range of view camera or scene depth
        min.z = Math.max(this._minZ, min.z);

        var left = Math.max(min.x, minBound.x);
        var right = Math.min(max.x, maxBound.x);
        var bottom = Math.max(min.y, minBound.y);
        var top = Math.min(max.y, maxBound.y);

        var width = right - left;
        var height = top - bottom;

        width = Math.ceil(width / scaleSnap) * scaleSnap;
        height = Math.ceil(height / scaleSnap) * scaleSnap;
        width = Math.max(width, scaleSnap);
        height = Math.max(height, scaleSnap);

        // snap to pixels
        var offsetSnapX = this._shadowMap._width / width * .5;
        var offsetSnapY = this._shadowMap._height / height * .5;

        left = Math.floor(left * offsetSnapX) / offsetSnapX;
        bottom = Math.floor(bottom * offsetSnapY) / offsetSnapY;
        right = left + width;
        top = bottom + height;

        // TODO: Reenable!
        var softness = 0;
        //var softness = light->GetShadowSoftness();

        camera.setBounds(left - softness, right + softness, top + softness, bottom - softness);

        camera.setFarDistance(-min.z);

        camera._setRenderTargetResolution(this._shadowMap._width, this._shadowMap._height);

        this._shadowMatrices[cascade].product(this._transformToUV[cascade], camera.getViewProjectionMatrix());
    }
};

HX.CascadeShadowMapRenderer.prototype._updateCullPlanes = function(viewCamera)
{
    var frustum = this._collectorCamera.getFrustum();
    var planes = frustum._planes;

    for (var i = 0; i < 4; ++i)
        this._cullPlanes[i] = planes[i];

    this._numCullPlanes = 4;

    frustum = viewCamera.getFrustum();
    planes = frustum._planes;

    var dir = this._light.getDirection();

    for (var j = 0; j < 6; ++j) {
        var plane = planes[j];

        // view frustum planes facing away from the light direction mark a boundary beyond which no shadows need to be known
        if (HX.dot3(plane, dir) < -0.001)
            this._cullPlanes[this._numCullPlanes++] = plane;
    }
};

HX.CascadeShadowMapRenderer.prototype._collectShadowCasters = function(scene)
{
    this._casterCollector.setCullPlanes(this._cullPlanes, this._numCullPlanes);
    this._casterCollector.setRenderCameras(this._shadowMapCameras);
    this._casterCollector.collect(this._collectorCamera, scene);
};

HX.CascadeShadowMapRenderer.prototype.getSplitDistances = function()
{
    return this._splitDistances
};

HX.CascadeShadowMapRenderer.prototype.getShadowMatrix = function(cascade)
{
    return this._shadowMatrices[cascade];
};

HX.CascadeShadowMapRenderer.prototype.dispose = function()
{
    HX.Renderer.call.dispose(this);
    this._shadowMap.dispose();
    this._shadowMap = null;
};

HX.CascadeShadowMapRenderer.prototype._invalidateShadowMap = function()
{
    this._shadowMapInvalid = true;
};

HX.CascadeShadowMapRenderer.prototype._initShadowMap = function()
{
    var numMapsW = this._numCascades > 1? 2 : 1;
    var numMapsH = Math.ceil(this._numCascades / 2);

    // TODO: Check if 16 bits is enough
    this._shadowMap.initEmpty(this._shadowMapSize * numMapsW, this._shadowMapSize * numMapsH, HX.GL.DEPTH_STENCIL, HX.EXT_DEPTH_TEXTURE.UNSIGNED_INT_24_8_WEBGL);
    this._fbo.init();
    this._shadowMapInvalid = false;

    this._viewports = [];
    this._viewports.push({x: 0, y: 0, width: this._shadowMapSize, height: this._shadowMapSize});
    this._viewports.push({x: this._shadowMapSize, y: 0, width: this._shadowMapSize, height: this._shadowMapSize});
    this._viewports.push({x: 0, y: this._shadowMapSize, width: this._shadowMapSize, height: this._shadowMapSize});
    this._viewports.push({x: this._shadowMapSize, y: this._shadowMapSize, width: this._shadowMapSize, height: this._shadowMapSize});

    this._initViewportMatrices(1.0 / numMapsW, 1.0 / numMapsH);
};

HX.CascadeShadowMapRenderer.prototype._initSplitRatios = function()
{
    var ratio = 1.0;
    this._splitRatios = [];
    this._splitDistances = [0, 0, 0, 0];
    for (var i = this._numCascades - 1; i >= 0; --i)
    {
        this._splitRatios[i] = ratio;
        this._splitDistances[i] = 0;
        ratio *= .4;
    }
};

HX.CascadeShadowMapRenderer.prototype._initCameras = function()
{
    this._shadowMapCameras = [];
    for (var i = this._numCascades - 1; i >= 0; --i)
    {
        this._shadowMapCameras[i] = new HX.OrthographicOffCenterCamera();
    }
}

HX.CascadeShadowMapRenderer.prototype._initViewportMatrices = function(scaleW, scaleH)
{
    for (var i = 0; i < 4; ++i) {
        // transform [-1, 1] to [0 - 1] (also for Z)
        this._transformToUV[i].scaleMatrix(.5, .5, .5);
        this._transformToUV[i].appendTranslation(.5, .5, .5);

        // transform to tiled size
        this._transformToUV[i].appendScale(scaleW, scaleH, 1.0);
    }

    this._transformToUV[1].appendTranslation(0.5, 0.0, 0.0);
    this._transformToUV[2].appendTranslation(0.0, 0.5, 0.0);
    this._transformToUV[3].appendTranslation(0.5, 0.5, 0.0);
};