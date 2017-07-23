import {PerspectiveCamera} from "../camera/PerspectiveCamera";
import {Float4} from "../math/Float4";
import {LightProbe} from "./LightProbe";
import {TextureCube} from "../texture/TextureCube";
import {FrameBuffer} from "../texture/FrameBuffer";
import {WriteOnlyDepthBuffer} from "../texture/WriteOnlyDepthBuffer";
import {Renderer} from "../render/Renderer";
import {CubeFace} from "../Helix";
import {Quaternion} from "../math/Quaternion";
import {Scene} from "../scene/Scene";
import {Skybox} from "../scene/Skybox";
import {GL} from "../core/GL";

/**
 * @classdesc
 * DynamicLightProbe is a {@linkcode LightProbe} that is rendered from the scene dynamically.
 *
 * @constructor
 *
 * @extends LightProbe
 *
 * @author derschmale <http://www.derschmale.com>
 */
function DynamicLightProbe(textureSize, textureDataType, near, far)
{
    // TODO: When collecting, make sure this light probe is NOT included!

    var diffuse = new TextureCube();
    var specular = new TextureCube();
    diffuse.initEmpty(2, null, textureDataType);
    specular.initEmpty(textureSize, null, textureDataType);

    near = near || .1;
    far = far || 1000.0;

    LightProbe.call(this, diffuse, specular);
    this._cameras = [];
    this._specularFBOs = [];
    this._diffuseFBOs = [];

    var depthBuffer = new WriteOnlyDepthBuffer();
    depthBuffer.init(textureSize, textureSize, false);

    var rotations = [];
    for (var i = 0; i < 6; ++i) {
        rotations[i] = new Quaternion();
    }

    rotations[0].fromAxisAngle(Float4.Y_AXIS, Math.PI * .5);
    rotations[1].fromAxisAngle(Float4.Y_AXIS, -Math.PI * .5);
    rotations[2].fromAxisAngle(Float4.X_AXIS, -Math.PI * .5);
    rotations[3].fromAxisAngle(Float4.X_AXIS, Math.PI * .5);
    rotations[4].fromAxisAngle(Float4.Y_AXIS, 0);
    rotations[5].fromAxisAngle(Float4.Y_AXIS, Math.PI);

    this._diffuseScene = new Scene();
    this._diffuseScene.skybox = new Skybox(specular);

    var cubeFaces = [ CubeFace.POSITIVE_X, CubeFace.NEGATIVE_X, CubeFace.POSITIVE_Y, CubeFace.NEGATIVE_Y, CubeFace.POSITIVE_Z, CubeFace.NEGATIVE_Z ];
    for (var i = 0; i < 6; ++i) {
        var camera = new PerspectiveCamera();
        camera.nearDistance = near;
        camera.farDistance = far;
        camera.verticalFOV = Math.PI * .5;
        camera.rotation.copyFrom(rotations[i]);
        camera.scale.set(1, -1, 1);
        this._cameras.push(camera);

        var fbo = new FrameBuffer(specular, depthBuffer, cubeFaces[i]);
        fbo.init();
        this._specularFBOs.push(fbo);

        fbo = new FrameBuffer(diffuse, null, cubeFaces[i]);
        fbo.init();
        this._diffuseFBOs.push(fbo);
    }

    this._renderer = new Renderer();
}

DynamicLightProbe.prototype = Object.create(LightProbe.prototype);

/**
 * Triggers an update of the light probe.
 */
DynamicLightProbe.prototype.render = function()
{
    var pos = this.worldMatrix.getColumn(3);

    for (var i = 0; i < 6; ++i) {
        this._cameras[i].position.copyFrom(pos);
        this._renderer.render(this._cameras[i], this._scene, 0, this._specularFBOs[i]);
    }

    this._specularTexture.generateMipmap();

    GL.setInvertCulling(true);

    for (i = 0; i < 6; ++i)
        this._renderer.render(this._cameras[i], this._diffuseScene, 0, this._diffuseFBOs[i]);

    GL.setInvertCulling(false);

    this._diffuseTexture.generateMipmap();
};

export {DynamicLightProbe};