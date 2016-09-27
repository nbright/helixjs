/**
 *
 * @param meshData
 * @param model
 * @constructor
 */
HX.Mesh = function (meshData, model)
{
    this._model = model;
    this._vertexBuffers = [];
    this._vertexStrides = [];
    this._indexBuffer = new HX.IndexBuffer();

    this._renderOrderHint = ++HX.Mesh.ID_COUNTER;

    this.updateMeshData(meshData);
};

HX.Mesh.ID_COUNTER = 0;


HX.Mesh.prototype = {
    constructor: HX.Mesh,

    updateMeshData: function(meshData)
    {
        var numStreams = meshData.numStreams;
        var numVertexBuffers = this._vertexBuffers.length;

        if (numStreams > numVertexBuffers) {
            for (var i = numVertexBuffers; i < numStreams; ++i) {
                this._vertexBuffers[i] = new HX.VertexBuffer();
            }
        }
        else if (numStreams < numVertexBuffers) {
            this._vertexBuffers.length = numStreams;
            this._vertexStrides.length = numStreams;
        }

        for (var i = 0; i < numStreams; ++i) {
            this._vertexBuffers[i].uploadData(meshData.getVertexData(i), meshData.vertexUsage);
            this._vertexStrides[i] = meshData.getVertexStride(i);
        }

        this._numIndices = meshData._indexData.length;

        this._indexBuffer.uploadData(meshData._indexData, meshData.indexUsage);
        this._vertexAttributes = meshData._vertexAttributes;
    },

    dispose: function ()
    {
        for (var i = 0; i < this._vertexBuffers.length; ++i)
            this._vertexBuffers[i].dispose();
        this._indexBuffer.dispose();
    },

    get numIndices()
    {
        return this._numIndices;
    },

    get numVertexAttributes()
    {
        return this._vertexAttributes.length;
    },

    getVertexStride: function(streamIndex)
    {
        return this._vertexStrides[streamIndex];
    },

    getVertexAttribute: function (index)
    {
        return this._vertexAttributes[index];
    }
};