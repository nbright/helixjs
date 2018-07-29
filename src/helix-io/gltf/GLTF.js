import * as HX from "helix";

// https://www.khronos.org/files/gltf20-reference-guide.pdf

/**
 * GLTFData contains all the info loaded
 * @constructor
 */
function GLTFData()
{
    /**
     * The default scene to show first, as defined by GLTF.
     */
    this.defaultScene = new HX.Scene();

    /**
     * The loaded scenes.
     */
    this.scenes = {};

    /**
     * The loaded materials.
     */
    this.materials = {};

    /**
     * The loaded models (these are "meshes" in GLTF).
     */
    this.models = {};

    /**
     * The loaded model instances (these are "nodes" containing a "mesh" in GLTF).
     */
    this.modelInstances = {};

    /**
     * The animations. Skinned animations cannot be parsed as SkeletonAnimation, since GLTF has no concept of animation
     * groups.
     */
    this.animations = {};
}

/**
 * GLTF is an importer for glTF files. When loading, GLTF will immediately return a GLTFAsset containing the default
 * scene (empty scene if not specified in the glTF file), and will populate this object as it's being loaded.
 *
 * @constructor
 *
 * @see {@link https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#introduction}
 */
function GLTF()
{
    // not sure if we're importing a scene?
    HX.Importer.call(this, GLTFData);

    this._numComponentLookUp = {
        SCALAR: 1,
        VEC2: 2,
        VEC3: 3,
        VEC4: 4,
        MAT4: 16
    };

    this._flipCoord = new HX.Matrix4x4();
    this._flipCoord.setColumn(0, new HX.Float4(-1, 0, 0, 0));
    this._flipCoord.setColumn(1, new HX.Float4(0, 0, 1, 0));
    this._flipCoord.setColumn(2, new HX.Float4(0, 1, 0, 0));
}

GLTF.prototype = Object.create(HX.Importer.prototype);

GLTF.prototype.parse = function(file, target)
{
    this._defaultSceneIndex = undefined;
    this._gltf = JSON.parse(file);

    var asset = this._gltf.asset;

    this._target = target;

    if (asset.hasOwnProperty("minVersion")){
        var minVersion = asset.minVersion.split(".");
        // TODO: check minVersion support
    }

    if (asset.hasOwnProperty("version")) {
        var version = asset.version.split(".");
        if (version[0] !== "2")
            throw new Error("Unsupported glTF version!");
    }

    this._assetLibrary = new HX.AssetLibrary();
    this._binFileCheck = {};

    // queue all assets for loading first

    this._queueImages();
    this._queueBuffers();

    // load dependencies first
    this._assetLibrary.onComplete.bind(function() { this._continueParsing(); }, this);
    this._assetLibrary.onProgress.bind(function(ratio) { this._notifyProgress(.8 * ratio); }, this);
    this._assetLibrary.load();
};

// todo: add some timeouts
GLTF.prototype._continueParsing = function()
{
    var gltf = this._gltf;

    if (gltf.hasOwnProperty("scene"))
        this._defaultSceneIndex = gltf.scene;

    var queue = new HX.AsyncTaskQueue();
    queue.queue(this._parseMaterials.bind(this));
    queue.queue(this._parseMeshes.bind(this));
    queue.queue(this._parseNodes.bind(this));
    queue.queue(this._parseScenes.bind(this));
    queue.queue(this._parseAnimations.bind(this));
    queue.queue(this._playAnimations.bind(this));
    queue.queue(this._notifyComplete.bind(this), this._target);

    queue.onProgress.bind((function(ratio) {
        this._notifyProgress(.8 + .2 * ratio);
    }).bind(this));

    queue.execute();
};

GLTF.prototype._getAccessor = function(index)
{
    var accessorDef = this._gltf.accessors[index];

    var bufferView;
    if (accessorDef.bufferView !== undefined)
         bufferView = this._getBufferView(accessorDef.bufferView);
    var f = {
        dataType: accessorDef.componentType,
        numComponents: this._numComponentLookUp[accessorDef.type],
        type: accessorDef.type,
        data: bufferView? bufferView.data : null,
        min: accessorDef.min,
        max: accessorDef.max,
        byteOffset: bufferView.byteOffset + (accessorDef.byteOffset || 0),
        dataType: accessorDef.componentType,
        count: accessorDef.count,
        isSparse: false
    };

    if (accessorDef.sparse) {
        f.isSparse = true;
        f.sparseCount = accessorDef.sparse.count;
        f.sparseOffsets = [];

        var indexBufferView = this._getBufferView(accessorDef.sparse.indices.bufferView);
        var valuesBufferView = this._getBufferView(accessorDef.sparse.values.bufferView);

        f.sparseIndices = {
            data: indexBufferView.data,
            byteOffset: accessorDef.sparse.indices.byteOffset,
            dataType: accessorDef.componentType
        };

        f.sparseValues = {
            data: valuesBufferView.data,
            byteOffset: accessorDef.values.indices.byteOffset
        };
    }

    return f;
};

GLTF.prototype._getBufferView = function(index)
{
    var bufferView = this._gltf.bufferViews[index];
    var buffer = this._buffers[bufferView.buffer];
    var byteOffset = buffer.byteOffset + (bufferView.byteOffset || 0);

    // HX.Debug.assert(byteOffset + bufferView.byteLength < buffer.byteOffset + buffer.byteLength, "bufferView out of bounds of buffer!");

    return {
        data: this._assetLibrary.get(buffer.assetID),
        byteOffset: byteOffset,
        byteLength: bufferView.byteLength
    };
};

GLTF.prototype._queueImages = function()
{
    var imageDefs = this._gltf.images;

    if (!imageDefs) return;

    for (var i = 0; i < imageDefs.length; ++i) {
        var image = imageDefs[i];
        this._assetLibrary.queueAsset("hx_image_" + i, this._correctURL(image.uri), HX.AssetLibrary.Type.ASSET, HX.JPG);
    }
};

GLTF.prototype._queueBuffers = function()
{
    var bufferDefs = this._gltf.buffers;

    if (!bufferDefs) return;

    this._buffers = [];
    for (var i = 0; i < bufferDefs.length; ++i) {
        var buffer = bufferDefs[i];
        if (!this._binFileCheck[buffer.uri]) {
            var assetID = "hx_bin_" + i;
            this._assetLibrary.queueAsset(assetID, this._correctURL(buffer.uri), HX.AssetLibrary.Type.RAW_BINARY);
            this._binFileCheck[buffer.uri] = true;
            this._buffers[i] = {
                assetID: assetID,
                byteOffset: buffer.byteOffset || 0,
                byteLength: buffer.byteLength
            }
        }
    }
};

GLTF.prototype._parseMaterials = function()
{
    var materialDefs = this._gltf.materials;

    if (!materialDefs) return;

    this._materials = [];

    for (var i = 0; i < materialDefs.length; ++i) {
        var matDef = materialDefs[i];
        var mat = new HX.BasicMaterial();

        mat.name = matDef.name;
        mat.specularMapMode = HX.BasicMaterial.SPECULAR_MAP_METALLIC_ROUGHNESS;
        mat.normalMap = this._getTexture(matDef.normalTexture);
        mat.occlusionMap = this._getTexture(matDef.occlusionTexture);
        mat.emissionMap = this._getTexture(matDef.emissiveTexture);

        if (matDef.emissiveFactor) {
            var emission = new HX.Color(matDef.emissiveFactor[0], matDef.emissiveFactor[1], matDef.emissiveFactor[2], 1.0);
            mat.emissiveColor = emission.linearToGamma();   // BasicMaterial expects gamma values
        }
        else if (mat.emissionMap)
            mat.emissiveColor = HX.Color.WHITE;

        var pbr = matDef.pbrMetallicRoughness;

        if (pbr) {
            mat.colorMap = this._getTexture(pbr.baseColorTexture);
            mat.specularMap = this._getTexture(pbr.metallicRoughnessTexture);

            if (pbr.baseColorFactor) {
                var color = new HX.Color(pbr.baseColorFactor[0], pbr.baseColorFactor[1], pbr.baseColorFactor[2], pbr.baseColorFactor[3]);
                mat.color = color.linearToGamma();  // BasicMaterial expects gamma values
            }

            mat.metallicness = pbr.metallicFactor === undefined ? 1.0 : pbr.metallicFactor;
            mat.roughness = pbr.roughnessFactor === undefined? 1.0 : pbr.roughnessFactor;

            if (mat.specularMap) {
                mat.roughness *= .5;
                mat.roughnessRange = -mat.roughness;
            }

            // TODO: There can also be a texCoord property with the textures, are those texCoord indices?
        }

        this._materials[i] = mat;
        this._target.materials[mat.name] = mat;
    }
};

GLTF.prototype._getTexture = function(textureDef)
{
    return textureDef? this._assetLibrary.get("hx_image_" + textureDef.index) : null;
};

GLTF.prototype._parseMeshes = function()
{
    var meshDefs = this._gltf.meshes;

    if (!meshDefs) return;

    // locally stored by index, using gltf nomenclature (actually contains model instances)
    this._modelInstances = [];
    for (var i = 0; i < meshDefs.length; ++i) {
        var meshDef = meshDefs[i];
        var model = new HX.Model();
        var materials = [];
        var targets = null;
        var numTargets = 0;
        var hasMorphNormals = false;

        for (var j = 0; j < meshDef.primitives.length; ++j) {
            var primDef = meshDef.primitives[j];

            // a bit messy, eh?
            if (primDef.targets) {
                numTargets = primDef.targets.length;
                targets = [];
                for (var k = 0; k < numTargets; ++k) {
                    targets[k] = new HX.MorphTarget();
                    targets[k].name = "morphTarget_" + k;
                }

                if (primDef.targets[0].NORMAL) {
                    hasMorphNormals = true;
                }
                break;
            }
        }

        for (j = 0; j < meshDef.primitives.length; ++j) {
            primDef = meshDef.primitives[j];
            this._parsePrimitive(primDef, model, materials, numTargets > 0, hasMorphNormals);

            if (primDef.targets)
                this._parseMorphTargets(primDef.targets, j, targets);
        }

        model.name = meshDef.name;

        var modelInstance = new HX.ModelInstance(model, materials);

        if (numTargets > 0) {
            var morphComponent = new HX.MorphAnimation(targets);

            if (meshDef.weights) {
                for (j = 0; j < numTargets; ++j) {
                    morphComponent.setWeight("morphTarget_" + j, meshDef.weights[j]);
                }
            }

            modelInstance.addComponent(morphComponent);
        }

        this._modelInstances[i] = modelInstance;
        this._target.models[model.name] = model;
    }
};

GLTF.prototype._parseMorphTargets = function(targetDefs, meshIndex, targets)
{
    for (var i = 0; i < targetDefs.length; ++i) {
        var attribs = targetDefs[i];
        var morphTarget = targets[i];
        var positionAcc = this._getAccessor(attribs.POSITION);
        var normalAcc = attribs.NORMAL !== undefined? this._getAccessor(attribs.NORMAL) : null;

        // tangent morphing not supported in Helix!
        // var tangentAcc = attribs.TANGENT !== undefined? this._getAccessor(attribs.TANGENT) : null;

        var positionData = new Float32Array(positionAcc.count * 3);
        this._readVertexData(positionData, 0, positionAcc, 3, 3, true);

        if (normalAcc) {
            var normalData = new Float32Array(normalAcc.count * 3);
            this._readVertexData(normalData, 0, normalAcc, 3, 3, true);
        }

        morphTarget.init(meshIndex, positionData, normalData);
    }
};


GLTF.prototype._parsePrimitive = function(primDef, model, materials, morphs, morphNormals)
{
    var mesh = HX.Mesh.createDefaultEmpty();
    var attribs = primDef.attributes;
    var positionAcc = this._getAccessor(attribs.POSITION);
    var normalAcc = attribs.NORMAL !== undefined? this._getAccessor(attribs.NORMAL) : null;
    var tangentAcc = attribs.TANGENT !== undefined? this._getAccessor(attribs.TANGENT) : null;
    var texCoordAcc = attribs.TEXCOORD_0 !== undefined? this._getAccessor(attribs.TEXCOORD_0) : null;
    var jointIndexAcc = attribs.JOINTS_0 !== undefined? this._getAccessor(attribs.JOINTS_0) : null;
    var jointWeightsAcc = attribs.WEIGHTS_0 !== undefined? this._getAccessor(attribs.WEIGHTS_0) : null;

    var normalGenMode = 0;

    var stride = mesh.getVertexStride(0);
    var vertexData = new Float32Array(positionAcc.count * stride);

    this._readVertexData(vertexData, 0, positionAcc, 3, stride, true);

    if (normalAcc)
        this._readVertexData(vertexData, 3, normalAcc, 3, stride, true);
    else
        normalGenMode = HX.NormalTangentGenerator.MODE_NORMALS;

    if (tangentAcc)
        this._readVertexData(vertexData, 6, tangentAcc, 4, stride, true);
    else if (texCoordAcc)
        normalGenMode = normalGenMode | HX.NormalTangentGenerator.MODE_TANGENTS;

    if (texCoordAcc)
        this._readUVData(vertexData, 10, texCoordAcc, stride);

    mesh.setVertexData(vertexData, 0);

    var indexAcc = this._getAccessor(primDef.indices);
    mesh.setIndexData(this._readIndices(indexAcc));

    if (normalGenMode) {
        var normalGen = new HX.NormalTangentGenerator();
        normalGen.generate(mesh);
    }

    if (jointIndexAcc) {
        mesh.addVertexAttribute("hx_jointIndices", 4, 1);
        mesh.addVertexAttribute("hx_jointWeights", 4, 1);
        stride = mesh.getVertexStride(1);

        var jointData = new Float32Array(jointIndexAcc.count * stride);
        this._readVertexData(jointData, 0, jointIndexAcc, 4, stride);
        this._readVertexData(jointData, 4, jointWeightsAcc, 4, stride);
        mesh.setVertexData(jointData, 1);
    }

    if (morphs)
        mesh.generateMorphData(morphNormals);

    model.addMesh(mesh);
    materials.push(this._materials[primDef.material]);
};

GLTF.prototype._readVertexData = function(target, offset, accessor, numComponents, stride, flipCoords)
{
    var p = offset;
    var o = accessor.byteOffset;
    var i;
    var len = accessor.count;
    var src = accessor.data;
    var readFnc;
    var elmSize;

    if (src) {
        if (accessor.dataType === HX.DataType.FLOAT) {
            readFnc = src.getFloat32;
            elmSize = 4;
        }
        else if (accessor.dataType === HX.DataType.UNSIGNED_SHORT) {
            readFnc = src.getUint16;
            elmSize = 2;
        }
        else if (accessor.dataType === HX.DataType.UNSIGNED_INT) {
            readFnc = src.getUint32;
            elmSize = 4;
        }

        for (i = 0; i < len; ++i) {
            for (var j = 0; j < numComponents; ++j) {
                target[p + j] = readFnc.call(src, o, true);
                o += elmSize;
            }

            p += stride;
        }
    }
    else {
        for (i = 0; i < len; ++i) {
            for (var j = 0; j < numComponents; ++j) {
                target[p + j] = 0.0;
            }
        }
        p += stride;
    }

    if (accessor.isSparse)
        this._applySparseAccessor(target, accessor, numComponents, stride, readFnc, elmSize);

    if (flipCoords) {
        p = offset;
        for (i = 0; i < len; ++i) {
            var tmp = target[p + 1];
            target[p] = -target[p];
            target[p + 1] = target[p + 2];
            target[p + 2] = tmp;
            p += stride;
        }
    }
};

GLTF.prototype._applySparseAccessor = function(target, accessor, numComponents, stride, valueReadFunc, valueElmSize)
{
    var len = accessor.sparseCount;
    var indexData = accessor.sparseIndices.data;
    var valueData = accessor.sparseValues.data;
    var id = accessor.sparseIndices.byteOffset;
    var o = accessor.sparseValues.byteOffset;
    var readIndexFnc, idSize;

    if (accessor.dataType === HX.DataType.UNSIGNED_SHORT) {
        readIndexFnc = indexData.getUint16;
        idSize = 2;
    }
    else if (accessor.dataType === HX.DataType.UNSIGNED_INT) {
        readIndexFnc = indexData.getUint32;
        idSize = 4;
    }

    for (var i = 0; i < len; ++i) {
        var index = readIndexFnc.call(indexData, id) * stride;

        for (var j = 0; j < numComponents; ++j) {
            var value = valueReadFunc.call(valueData, o, true);
            o += valueElmSize;
            target[index + j] = value;
        }
        id += idSize;
    }
};

GLTF.prototype._readUVData = function(target, offset, accessor, stride)
{
    var p = offset;
    var o = accessor.byteOffset;
    var len = accessor.count;
    var src = accessor.data;

    for (var i = 0; i < len; ++i) {
        target[p] = src.getFloat32(o, true);
        target[p + 1] = 1.0 - src.getFloat32(o + 4, true);

        o += 8;
        p += stride;
    }
};

GLTF.prototype._readIndices = function(accessor)
{
    var o = accessor.byteOffset;
    var src = accessor.data;
    var len = accessor.count;
    var readFnc;
    var collType;
    var elmSize;

    if (accessor.dataType === HX.DataType.UNSIGNED_SHORT) {
        collType = Uint16Array;
        readFnc = src.getUint16;
        elmSize = 2;
    }
    else if (accessor.dataType === HX.DataType.UNSIGNED_INT) {
        collType = Uint32Array;
        readFnc = src.getUint32;
        elmSize = 4;
    }

    var indexData = new collType(len);
    for (var i = 0; i < len; ++i) {
        indexData[i] = readFnc.call(src, o, true);
        o += elmSize;
    }

    return indexData;
};

GLTF.prototype._parseSkin = function(nodeDef, target)
{
    var skinIndex = nodeDef.skin;
    var skinDef = this._gltf.skins[skinIndex];

    var invBinAcc = this._getAccessor(skinDef.inverseBindMatrices);

    var src = invBinAcc.data;
    var o = invBinAcc.byteOffset;

    var skeleton = new HX.Skeleton();
    var pose = new HX.SkeletonPose();

    var skelNode = this._nodes[skinDef.skeleton];

    // no need for it to end up in the scene graph
    if (skelNode.parent) skelNode.parent.detach(skelNode);

    for (var i = 0; i < skinDef.joints.length; ++i) {
        var nodeIndex = skinDef.joints[i];
        var joint = new HX.SkeletonJoint();

        joint.inverseBindPose = this._readMatrix4x4(src, o);
        o += 64;

        joint.inverseBindPose.prepend(this._flipCoord);
        joint.inverseBindPose.append(this._flipCoord);

        skeleton.addJoint(joint);

        var node = this._nodes[nodeIndex];
        if (node._jointIndex !== undefined) {
            throw new Error("Adding one node to multiple skeletons!");
        }
        node._jointIndex = i;
        node._skeletonPose = pose;

        var jointPose = new HX.SkeletonJointPose();
        jointPose.position.copyFrom(node.position);
        jointPose.rotation.copyFrom(node.rotation);
        jointPose.scale.copyFrom(node.scale);
        pose.setJointPose(i, jointPose);
    }

    for (i = 0; i < skinDef.joints.length; ++i) {
        var nodeIndex = skinDef.joints[i];
        var node = this._nodes[nodeIndex];
        var joint = skeleton.getJoint(i);
        joint.parentIndex = node !== skelNode && node.parent? node.parent._jointIndex : -1;
    }

    target.model.skeleton = skeleton;
    target.skeletonPose = pose;
};

// TODO: The whole nodes 6 animation parsing thing is messy. Clean up
GLTF.prototype._parseNodes = function()
{
    var nodeDefs = this._gltf.nodes;

    if (!nodeDefs) return;

    var m = new HX.Matrix4x4();

    this._nodes = [];

    // these may also be skeleton joints, will be determined when parsing skeleton
    for (var i = 0; i < nodeDefs.length; ++i) {
        var nodeDef = nodeDefs[i];
        var node;

        if (nodeDef.hasOwnProperty("mesh")) {
            node = this._modelInstances[nodeDef.mesh];
            // if the node has a specific name, use that.
            // otherwise (for model instances possible), use the model name, or assign a unique one
            node.name = nodeDef.name || node.model.name || ("node_" + i);
            this._target.modelInstances[node.name] = node;
        }
        else
            node = new HX.SceneNode();

        if (nodeDef.rotation) {
            node.rotation.set(nodeDef.rotation[0], nodeDef.rotation[1], nodeDef.rotation[2], nodeDef.rotation[3]);
            m.fromQuaternion(node.rotation);
            m.prepend(this._flipCoord);
            m.append(this._flipCoord);
            node.rotation.fromMatrix(m);
        }

        if (nodeDef.translation)
            node.position.set(nodeDef.translation[0], nodeDef.translation[1], -nodeDef.translation[2], 1.0);

        if (nodeDef.scale)
            node.scale.set(nodeDef.scale[0], nodeDef.scale[1], nodeDef.scale[2], 1.0);

        if (nodeDef.matrix) {
            node.matrix = new HX.Matrix4x4(nodeDef.matrix);
            node.matrix.prepend(this._flipCoord);
            node.matrix.append(this._flipCoord);
        }

        this._nodes[i] = node;
    }

    // all parsed, now we can attach them together
    for (i = 0; i < nodeDefs.length; ++i) {
        nodeDef = nodeDefs[i];
        node = this._nodes[i];
        if (nodeDef.children) {
            for (var j = 0; j < nodeDef.children.length; ++j) {
                var childIndex = nodeDef.children[j];
                node.attach(this._nodes[childIndex]);
            }
        }
    }

    for (i = 0; i < nodeDefs.length; ++i) {
        nodeDef = nodeDefs[i];
        node = this._nodes[i];

        if (nodeDef.hasOwnProperty("skin"))
            this._parseSkin(nodeDef, node);
    }
};

GLTF.prototype._parseScenes = function()
{
    var sceneDefs = this._gltf.scenes;

    if (!sceneDefs) return;

    for (var i = 0; i < sceneDefs.length; ++i) {
        var sceneDef = sceneDefs[i];
        var scene;

        // this because a scene was already created for immediate access
        if (i === this._defaultSceneIndex)
            scene = this._target.defaultScene;
        else {
            scene = new HX.Scene();
            this._target.scenes.push(scene);
        }

        var childNodes = sceneDef.nodes;
        for (var j = 0; j < childNodes.length; ++j) {
            var nodeIndex = childNodes[j];
            scene.attach(this._nodes[nodeIndex]);
        }
    }
};

GLTF.prototype._parseAnimationSampler = function(samplerDef, flipCoords)
{
    var timesAcc = this._getAccessor(samplerDef.input);
    var valuesAcc = this._getAccessor(samplerDef.output);
    var timeSrc = timesAcc.data;
    var valueSrc = valuesAcc.data;
    var t = timesAcc.byteOffset;
    var v = valuesAcc.byteOffset;
    var m = new HX.Matrix4x4();

    // in the case of weights
    var elmCount = valuesAcc.count / timesAcc.count;

    var clips = [];

    if (elmCount === 1)
        var clip = clips[0] = new HX.AnimationClip();
    else {
        for (var i = 0; i < elmCount; ++i) {
            clips[i] = new HX.AnimationClip();
        }
    }

    // valuesAcc can be a multiple of timesAcc, if it contains more weights

    for (var k = 0; k < timesAcc.count; ++k) {
        var value;

        switch(valuesAcc.numComponents) {
            case 1:
                value = [];
                for (i = 0; i < elmCount; ++i)
                    value[i] = this._readFloat(valueSrc, v + i * 4);
                break;
            case 3:
                value = this._readFloat3(valueSrc, v);
                if (flipCoords) {
                    value.x = -value.x;
                    var tmp = value.y;
                    value.y = value.z;
                    value.z = tmp;
                }
                break;
            case 4:
                value = this._readQuat(valueSrc, v);
                if (flipCoords) {
                    m.fromQuaternion(value);
                    m.prepend(this._flipCoord);
                    m.append(this._flipCoord);
                    value.fromMatrix(m);
                }
                break;
            default:
                throw new Error("Unsupported animation sampler type");
        }

        var time = this._readFloat(timeSrc, t) * 1000.0;
        var keyFrame;

        if (elmCount === 1) {
            keyFrame = new HX.KeyFrame(time, value);
            clip.addKeyFrame(keyFrame);
        }
        else {
            for (var i = 0; i < elmCount; ++i) {
                keyFrame = new HX.KeyFrame(time, value[i]);
                clips[i].addKeyFrame(keyFrame);
            }
        }

        v += valuesAcc.numComponents * elmCount * 4;
        t += 4;
    }

    return clips;
};


GLTF.prototype._parseAnimations = function()
{
    var animDefs = this._gltf.animations;

    if (!animDefs) return;

    for (var i = 0; i < animDefs.length; ++i) {
        var animDef = animDefs[i];
        var animation = new HX.LayeredAnimation();

        for (var j = 0; j < animDef.channels.length; ++j) {
            var layers = this._parseAnimationChannel(animDef.channels[j], animDef.samplers);
            for (var k = 0; k < layers.length; ++k)
                animation.addLayer(layers[k]);
        }

        animation.name = animDef.name || "animation_" + i;
        this._target.animations[animation.name] = animation;
    }
};

GLTF.prototype._parseAnimationChannel = function(channelDef, samplers)
{
    var target = this._nodes[channelDef.target.node];
    var layers = [];

    if (target._jointIndex !== undefined)
        target = target._skeletonPose._jointPoses[target._jointIndex];

    switch (channelDef.target.path) {
        case "translation":
            var clips = this._parseAnimationSampler(samplers[channelDef.sampler], true);
            layers = [ new HX.AnimationLayerFloat4(target, "position", clips[0]) ];
            break;
        case "rotation":
            var clips = this._parseAnimationSampler(samplers[channelDef.sampler], true);
            layers = [ new HX.AnimationLayerQuat(target, "rotation", clips[0]) ] ;
            break;
        case "scale":
            var clips = this._parseAnimationSampler(samplers[channelDef.sampler], false);
            layers = [ new HX.AnimationLayerFloat4(target, "scale", clips[0]) ];
            break;
        case "weights":
            var clips = this._parseAnimationSampler(samplers[channelDef.sampler], false);

            layers = [];

            for (var i = 0; i < clips.length; ++i)
                layers.push(new HX.AnimationLayerMorphTarget(target.getFirstComponentByType(HX.MorphAnimation), "morphTarget_" + i, clips[i]));

            break;
        default:
            throw new Error("Unknown channel path!");
    }
    return layers;
};

GLTF.prototype._playAnimations = function()
{
    var anims = this._target.animations;
    HX.ArrayUtils.forEach(anims, function(anim) {
        anim.play();
    });
};

GLTF.prototype._readFloat3 = function(dataView, offset)
{
    var f = new HX.Float4();
    f.x = dataView.getFloat32(offset, true);
    f.y = dataView.getFloat32(offset + 4, true);
    f.z = dataView.getFloat32(offset + 8, true);
    return f;
};

GLTF.prototype._readQuat = function(dataView, offset)
{
    var q = new HX.Quaternion();
    q.x = dataView.getFloat32(offset, true);
    q.y = dataView.getFloat32(offset + 4, true);
    q.z = dataView.getFloat32(offset + 8, true);
    q.w = dataView.getFloat32(offset + 12, true);
    return q;
};

GLTF.prototype._readFloat = function(dataView, offset)
{
    return dataView.getFloat32(offset, true);
};

GLTF.prototype._readMatrix4x4 = function(dataView, offset)
{
    var m = [];
    for (var j = 0; j < 16; ++j) {
        m[j] = dataView.getFloat32(offset, true);
        offset += 4;
    }
    return new HX.Matrix4x4(m);
};

export {GLTF, GLTFData};